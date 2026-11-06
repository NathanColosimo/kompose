import type { LinkResolver } from "./link-resolver";
import { spotifyResolver } from "./spotify/server";
import { substackResolver } from "./substack/server";
import { youtubeResolver } from "./youtube/server";

/** Server-only: every `link-resolver` plugin, tried in this order. */
export const linkResolvers: readonly LinkResolver[] = [
  spotifyResolver,
  youtubeResolver,
  substackResolver,
];
