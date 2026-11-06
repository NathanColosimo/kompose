import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import type { LinkMeta } from "@kompose/db/schema/link";
import { Effect, Schema } from "effect";
import { Agent } from "undici";
import type { z } from "zod";

/**
 * The `link-resolver` capability: turns a URL into link metadata for a task.
 * `LinkParserService` (in @kompose/api) asks each resolver in turn and falls
 * back to the page's Open Graph tags. See documents/link-parsing.md.
 */
export interface LinkResolver {
  matches: (url: URL) => boolean;
  pluginId: string;
  resolve: (url: string) => Effect.Effect<LinkMeta, LinkParseError>;
}

export class LinkParseError extends Schema.TaggedError<LinkParseError>()(
  "LinkParseError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    url: Schema.String,
  }
) {
  /** `message` describes the failure for logs, so users get a fixed one. */
  get publicError() {
    return {
      code: "UNPROCESSABLE_CONTENT",
      message: "Couldn't load details for this link.",
    } as const;
  }
}

/** A request a resolver makes while resolving a link. */
export interface ResolverRequest {
  init?: RequestInit;
  /** Names the request in error messages, e.g. "Spotify token". */
  label: string;
  /** The link being resolved, for `LinkParseError.url`. */
  link: string;
  url: string;
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

const publicOnlyDispatcher = new Agent({
  connect: { lookup: publicOnlyLookup },
});

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** An http(s) URL whose host isn't a non-public IP or a name like `localhost`. */
function isPublicHttpUrl(url: URL) {
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    isPublicRoutableHost(url.hostname)
  );
}

/**
 * Fetches a URL on the public internet. Links come from users, so this guards
 * against SSRF: redirects are followed by hand so each hop's URL is checked,
 * up to five, and `publicOnlyLookup` checks every address it connects to. A
 * non-2xx response is a `LinkParseError`. See documents/link-parsing.md.
 */
function fetchOk({ init, label, link, url }: ResolverRequest) {
  return Effect.gen(function* () {
    const fail = (message: string, cause?: unknown) =>
      new LinkParseError({ cause, message, url: link });

    // Node's fetch takes undici's `dispatcher`; the DOM `RequestInit` type
    // that web and native check this file with doesn't list it.
    const options = {
      ...init,
      dispatcher: publicOnlyDispatcher,
      redirect: "manual" as const,
    };
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const current = URL.canParse(target) ? new URL(target) : null;
      if (!(current && isPublicHttpUrl(current))) {
        return yield* fail(`${label} isn't a public http(s) URL: ${target}`);
      }
      const response = yield* Effect.tryPromise({
        catch: (cause) => fail(`Failed to fetch ${label}`, cause),
        try: () => fetch(current, options),
      });

      const location = response.headers.get("location");
      if (!(REDIRECT_STATUSES.has(response.status) && location)) {
        if (!response.ok) {
          return yield* fail(`${label} returned ${response.status}`);
        }
        return response;
      }
      // Free the connection; only the Location header is needed.
      yield* Effect.promise(async () => await response.body?.cancel());
      target = URL.canParse(location, current.href)
        ? new URL(location, current).href
        : location;
    }
    return yield* fail(`${label} redirected more than ${MAX_REDIRECTS} times`);
  });
}

/** The response body; a failed request or a non-2xx status is a `LinkParseError`. */
export function fetchText(
  request: ResolverRequest
): Effect.Effect<string, LinkParseError> {
  return fetchOk(request).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({
        catch: (cause) =>
          new LinkParseError({
            cause,
            message: `Failed to read ${request.label} response`,
            url: request.link,
          }),
        try: () => response.text(),
      })
    )
  );
}

/** The response's JSON checked against `schema`; any failure is a `LinkParseError`. */
export function fetchJson<T>(
  request: ResolverRequest,
  schema: z.ZodType<T>
): Effect.Effect<T, LinkParseError> {
  return Effect.gen(function* () {
    const response = yield* fetchOk(request);
    const json: unknown = yield* Effect.tryPromise({
      catch: (cause) =>
        new LinkParseError({
          cause,
          message: `Failed to parse ${request.label} response`,
          url: request.link,
        }),
      try: () => response.json(),
    });
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return yield* new LinkParseError({
        message: `Invalid ${request.label} response: ${parsed.error.message}`,
        url: request.link,
      });
    }
    return parsed.data;
  });
}

const FIFTEEN_MINUTES_SECS = 900;

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "...",
  ldquo: '"',
  lsquo: "'",
  lt: "<",
  mdash: "--",
  nbsp: " ",
  ndash: "-",
  quot: '"',
  rdquo: '"',
  rsquo: "'",
};

function decodeEntity(entity: string): string {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isNaN(codePoint)
      ? `&${entity};`
      : String.fromCodePoint(codePoint);
  }

  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isNaN(codePoint)
      ? `&${entity};`
      : String.fromCodePoint(codePoint);
  }

  return HTML_ENTITY_MAP[entity] ?? `&${entity};`;
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) =>
    decodeEntity(entity)
  );
}

function decodeOptionalString(value: string | undefined): string | undefined {
  return value ? decodeHtmlEntities(value) : value;
}

export function normalizeLinkMetaText<T extends LinkMeta>(meta: T): T {
  const normalized = {
    ...meta,
    description: decodeOptionalString(meta.description),
    title: decodeOptionalString(meta.title),
  };

  if ("artistName" in normalized) {
    normalized.artistName = decodeOptionalString(normalized.artistName);
  }
  if ("channelName" in normalized) {
    normalized.channelName = decodeOptionalString(normalized.channelName);
  }
  if ("authorName" in normalized) {
    normalized.authorName = decodeOptionalString(normalized.authorName);
  }

  return normalized;
}

/** Round seconds to the nearest 15-minute increment */
export function roundToNearest15Min(seconds: number): number {
  return Math.round(seconds / FIFTEEN_MINUTES_SECS) * FIFTEEN_MINUTES_SECS;
}
