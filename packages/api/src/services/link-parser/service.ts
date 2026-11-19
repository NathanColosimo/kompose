import { Context, Effect, Layer } from "effect";
import { spotifyResolver } from "./providers/spotify";
import { substackResolver } from "./providers/substack";
import { parseUnknownLink } from "./providers/unknown";
import { youtubeResolver } from "./providers/youtube";
import { type LinkResolver, normalizeLinkMetaText } from "./types";

/** Tried in this order; the first whose `matches` accepts the URL resolves it. */
const linkResolvers: readonly LinkResolver[] = [
  spotifyResolver,
  youtubeResolver,
  substackResolver,
];

/**
 * Metadata from the first resolver that matches, else the page's Open Graph
 * tags. Every fetch goes through the SSRF-checked helpers in `fetch.ts`.
 */
const parseLink = Effect.fn("LinkParserService.parseLink")(function* (
  url: string
) {
  yield* Effect.log("Parsing link", { url });

  const parsed = new URL(url);
  const resolver = linkResolvers.find((candidate) => candidate.matches(parsed));
  const meta = resolver
    ? yield* resolver.resolve(url)
    : yield* parseUnknownLink(url);
  return normalizeLinkMetaText(meta);
});

export class LinkParserService extends Context.Service<LinkParserService>()(
  "LinkParserService",
  {
    make: Effect.succeed({ parseLink }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
