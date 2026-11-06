import { normalizeLinkMetaText } from "@kompose/plugins/link-resolver";
import { linkResolvers } from "@kompose/plugins/link-resolvers";
import { Context, Effect, Layer } from "effect";
import { parseUnknownLink } from "./open-graph";

/**
 * Metadata from the first `link-resolver` plugin that matches, else Open Graph
 * tags. Every fetch goes through the resolvers' SSRF-checked `fetchOk`.
 */
const parseLink = Effect.fn("LinkParserService.parseLink")(function* (
  url: string
) {
  const parsed = new URL(url);
  const resolver = linkResolvers.find((candidate) => candidate.matches(parsed));
  yield* Effect.log("Parsing link", { pluginId: resolver?.pluginId, url });

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
