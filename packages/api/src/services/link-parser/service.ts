import { Context, Effect, Layer } from "effect";
import { detectProvider } from "./providers/detect";
import { parseSpotifyLink } from "./providers/spotify";
import { parseSubstackLink } from "./providers/substack";
import { parseUnknownLink } from "./providers/unknown";
import { parseYoutubeLink } from "./providers/youtube";
import { LinkParseError, normalizeLinkMetaText } from "./types";

/**
 * Detect provider from URL and fetch metadata. Every fetch goes through the
 * SSRF-checked helpers in `fetch.ts`.
 */
const parseLink = Effect.fn("LinkParserService.parseLink")(function* (
  url: string
) {
  yield* Effect.log("Parsing link", { url });

  const provider = detectProvider(url);
  yield* Effect.log("Detected provider", { provider, url });

  switch (provider) {
    case "spotify":
      return normalizeLinkMetaText(yield* parseSpotifyLink(url));
    case "youtube":
      return normalizeLinkMetaText(yield* parseYoutubeLink(url));
    case "substack":
      return normalizeLinkMetaText(yield* parseSubstackLink(url));
    case "unknown":
      return normalizeLinkMetaText(yield* parseUnknownLink(url));
    default:
      return yield* new LinkParseError({
        message: `Unsupported provider: ${provider as string}`,
        url,
      });
  }
});

export class LinkParserService extends Context.Service<LinkParserService>()(
  "LinkParserService",
  {
    make: Effect.succeed({ parseLink }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
