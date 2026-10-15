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
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to fetch page for OG metadata",
        url,
      }),
    try: () =>
      fetch(url, {
        headers: {
          Accept: "text/html",
          "User-Agent":
            "Mozilla/5.0 (compatible; KomposeBot/1.0; +https://kompose.app)",
        },
        redirect: "follow",
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      message: `Page returned ${response.status}`,
      url,
    });
  }

  const html = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to read response body",
        url,
      }),
    try: () => response.text(),
  });

  const result: LinkMeta & { provider: "unknown" } = {
    description: extractMeta(html, "og:description"),
    fetchedAt: new Date().toISOString(),
    provider: "unknown",
    thumbnailUrl: extractMeta(html, "og:image"),
    title: extractMeta(html, "og:title"),
    url,
  };

  return result;
});
