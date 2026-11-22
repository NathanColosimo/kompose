import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { Effect } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { Agent } from "undici";
import type { z } from "zod";
import { LinkParseError } from "./types";

/** A request a resolver makes while resolving a link. */
export interface ResolverRequest {
  /** Names the request in error messages, e.g. "Spotify token". */
  label: string;
  /** The link being resolved, for `LinkParseError.url`. */
  link: string;
  request: HttpClientRequest.HttpClientRequest;
}

/**
 * Resolves a hostname for a link fetch and fails unless every address is
 * public. It runs when the connection is made, on the addresses it connects
 * to, so a DNS answer can't change between the check and the connect.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) =>
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    const [first] = addresses ?? [];
    if (error || !first) {
      callback(error ?? new Error(`No addresses for ${hostname}`), "");
    } else if (
      !addresses.every((entry) => isPublicRoutableHost(entry.address))
    ) {
      callback(new Error(`${hostname} resolves to a non-public address`), "");
    } else if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, first.address, first.family);
    }
  });

const MAX_REDIRECTS = 5;

/**
 * Passed to `fetch` on every hop. Effect follows the redirects, so `fetch`
 * must not. Node's fetch takes undici's `dispatcher`; the DOM `RequestInit`
 * type that web and native check this file with doesn't list it.
 */
const fetchOptions = {
  dispatcher: new Agent({ connect: { lookup: publicOnlyLookup } }),
  redirect: "manual" as const,
};

/** An http(s) URL whose host isn't a non-public IP or a name like `localhost`. */
function isPublicHttpUrl(href: string) {
  const url = URL.canParse(href) ? new URL(href) : null;
  return (
    (url?.protocol === "https:" || url?.protocol === "http:") &&
    isPublicRoutableHost(url.hostname)
  );
}

/**
 * Sends a request to the public internet and reads the response. Links come
 * from users, so this guards against SSRF: Effect's client follows up to five
 * redirects, the URL check runs on every hop, and `publicOnlyLookup` checks
 * every address a hop connects to. A non-2xx response fails. Every failure is
 * a `LinkParseError`. See documents/link-parsing.md.
 */
function send<A>(
  { label, link, request }: ResolverRequest,
  read: (
    response: HttpClientResponse.HttpClientResponse
  ) => Effect.Effect<A, HttpClientError.HttpClientError>
): Effect.Effect<A, LinkParseError> {
  return HttpClient.HttpClient.use((client) =>
    client
      .pipe(
        HttpClient.transform((response, hop) =>
          isPublicHttpUrl(hop.url)
            ? response
            : Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.InvalidUrlError({
                    description: "Not a public http(s) URL",
                    request: hop,
                  }),
                })
              )
        ),
        HttpClient.followRedirects(MAX_REDIRECTS),
        HttpClient.filterStatusOk
      )
      .execute(request)
  ).pipe(
    Effect.flatMap(read),
    Effect.mapError(
      (cause) =>
        new LinkParseError({
          cause,
          message: `${label}: ${cause.message}`,
          url: link,
        })
    ),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, fetchOptions),
    // Keep our trace headers off other people's servers.
    Effect.provideService(HttpClient.TracerPropagationEnabled, false)
  );
}

/** The response body as text. */
export function fetchText(request: ResolverRequest) {
  return send(request, (response) => response.text);
}

/** The response's JSON, checked against `schema`. */
export function fetchJson<T>(request: ResolverRequest, schema: z.ZodType<T>) {
  return send(request, (response) => response.json).pipe(
    Effect.flatMap((json) => {
      const parsed = schema.safeParse(json);
      return parsed.success
        ? Effect.succeed(parsed.data)
        : Effect.fail(
            new LinkParseError({
              message: `Invalid ${request.label} response: ${parsed.error.message}`,
              url: request.link,
            })
          );
    })
  );
}
