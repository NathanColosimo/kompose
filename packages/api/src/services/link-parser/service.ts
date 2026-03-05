import dns from "node:dns/promises";
import net from "node:net";
import { Effect } from "effect";
import { detectProvider } from "./providers/detect";
import { parseSpotifyLink } from "./providers/spotify";
import { parseSubstackLink } from "./providers/substack";
import { parseUnknownLink } from "./providers/unknown";
import { parseYoutubeLink } from "./providers/youtube";
import { LinkParseError } from "./types";

// RFC 1918, loopback, link-local, and other reserved IPv4/IPv6 ranges
const PRIVATE_IP_PREFIXES = [
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
  "127.",
  "0.",
  "169.254.",
];
const PRIVATE_IPV6 = ["::1", "fe80:", "fc00:", "fd00:"];

function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    PRIVATE_IP_PREFIXES.some((p) => lower.startsWith(p)) ||
    PRIVATE_IPV6.some((p) => lower.startsWith(p))
  );
}

/** Reject URLs that target private/internal hosts (SSRF protection) */
const validateUrlTarget = Effect.fn("LinkParserService.validateUrl")(function* (
  url: string
) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return yield* new LinkParseError({ url, message: "Invalid URL" });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return yield* new LinkParseError({
      url,
      message: "Only http/https URLs are supported",
    });
  }

  const { hostname } = parsed;

  // Block IP literals directly (e.g. http://127.0.0.1, http://[::1])
  if (net.isIP(hostname) || hostname.startsWith("[")) {
    const raw = hostname.replace(/^\[|\]$/g, "");
    if (isPrivateIp(raw)) {
      return yield* new LinkParseError({
        url,
        message: "URL targets a private/internal address",
      });
    }
  }

  // Resolve hostname to IPs — fail closed if resolution fails
  const addresses = yield* Effect.tryPromise({
    try: () => dns.resolve4(hostname),
    catch: () =>
      new LinkParseError({
        url,
        message: "DNS resolution failed — cannot verify URL target",
      }),
  });

  if (addresses.length === 0) {
    return yield* new LinkParseError({
      url,
      message: "DNS resolution returned no addresses",
    });
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      return yield* new LinkParseError({
        url,
        message: "URL targets a private/internal address",
      });
    }
  }
});

/** Detect provider from URL and fetch metadata */
const parseLink = Effect.fn("LinkParserService.parseLink")(function* (
  url: string
) {
  yield* Effect.log("Parsing link", { url });

  yield* validateUrlTarget(url);

  const provider = detectProvider(url);
  yield* Effect.log("Detected provider", { provider, url });

  switch (provider) {
    case "spotify":
      return yield* parseSpotifyLink(url);
    case "youtube":
      return yield* parseYoutubeLink(url);
    case "substack":
      return yield* parseSubstackLink(url);
    case "unknown":
      return yield* parseUnknownLink(url);
    default:
      return yield* new LinkParseError({
        url,
        message: `Unsupported provider: ${provider as string}`,
      });
  }
});

export class LinkParserService extends Effect.Service<LinkParserService>()(
  "LinkParserService",
  {
    accessors: true,
    effect: Effect.succeed({ parseLink }),
  }
) {}
