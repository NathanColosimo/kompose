import type { LinkMeta } from "@kompose/db/schema/link";
import { Effect } from "effect";
import { LinkParseError } from "../types";

/** Extract content of a meta tag by property or name attribute */
function extractMeta(html: string, attr: string): string | undefined {
  const regex = new RegExp(
    `<meta\\s+(?:[^>]*?(?:property|name)=["']${attr}["'][^>]*?content=["']([^"']*?)["']|[^>]*?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${attr}["'])`,
    "i"
  );
  const match = html.match(regex);
  return match?.[1] ?? match?.[2];
}

/** Fallback parser: fetch page and extract Open Graph meta tags */
export const parseUnknownLink = Effect.fn("Unknown.parseLink")(function* (
  url: string
) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; KomposeBot/1.0; +https://kompose.app)",
          Accept: "text/html",
        },
        redirect: "follow",
      }),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to fetch page for OG metadata",
        cause,
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      url,
      message: `Page returned ${response.status}`,
    });
  }

  const html = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to read response body",
        cause,
      }),
  });

  const result: LinkMeta & { provider: "unknown" } = {
    provider: "unknown",
    title: extractMeta(html, "og:title"),
    description: extractMeta(html, "og:description"),
    thumbnailUrl: extractMeta(html, "og:image"),
    url,
    fetchedAt: new Date().toISOString(),
  };

  return result;
});
