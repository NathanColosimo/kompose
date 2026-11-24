import type { LinkMeta } from "@kompose/db/schema/link";
import { Effect } from "effect";
import { HttpClientRequest } from "effect/http";
import { fetchText } from "../fetch";

/** Accept property/name and content in either attribute order. */
function extractMeta(html: string, attr: string): string | undefined {
  const regex = new RegExp(
    `<meta\\s+(?:[^>]*?(?:property|name)=["']${attr}["'][^>]*?content=["']([^"']*?)["']|[^>]*?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${attr}["'])`,
    "iu"
  );
  const match = html.match(regex);
  return match?.[1] ?? match?.[2];
}

export const parseUnknownLink = Effect.fn("Unknown.parseLink")(function* (
  url: string
) {
  const html = yield* fetchText({
    label: "Page",
    link: url,
    request: HttpClientRequest.get(url, {
      accept: "text/html",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KomposeBot/1.0; +https://kompose.app)",
      },
    }),
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
