import type { LinkMeta } from "@kompose/db/schema/link";
import { env } from "@kompose/env";
import { Effect } from "effect";
import { z } from "zod";
import {
  fetchJson,
  LinkParseError,
  type LinkResolver,
  roundToNearest15Min,
} from "../link-resolver";

// ============================================================================
// Zod schemas for YouTube Data API v3 responses
// ============================================================================

const YOUTUBE_VIDEO_ID_PATTERNS = [
  /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

/** The video ID in a watch, youtu.be, or Shorts URL */
function parseYoutubeVideoId(url: string): string | null {
  for (const pattern of YOUTUBE_VIDEO_ID_PATTERNS) {
    const id = url.match(pattern)?.[1];
    if (id) {
      return id;
    }
  }
  return null;
}

const youtubeVideoItem = z.object({
  contentDetails: z.object({
    duration: z.string(),
  }),
  snippet: z.object({
    channelTitle: z.string(),
    description: z.string(),
    thumbnails: z.object({
      default: z.object({ url: z.string() }).optional(),
      high: z.object({ url: z.string() }).optional(),
    }),
    title: z.string(),
  }),
});

const youtubeVideosResponse = z.object({
  items: z.array(youtubeVideoItem),
});

const ISO_DURATION_PATTERN = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;

/** Parse YouTube's hours/minutes/seconds duration form, e.g. PT1H2M10S. */
function parseIsoDuration(iso: string): number {
  const match = iso.match(ISO_DURATION_PATTERN);
  if (!match) {
    return 0;
  }
  const hours = Number.parseInt(match[1] || "0", 10);
  const minutes = Number.parseInt(match[2] || "0", 10);
  const seconds = Number.parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Fetch metadata for a YouTube video via Data API v3 */
const parseYoutubeLink = Effect.fn("YouTube.parseLink")(function* (
  url: string
) {
  const videoId = parseYoutubeVideoId(url);
  if (!videoId) {
    return yield* new LinkParseError({
      message: "Could not extract YouTube video ID",
      url,
    });
  }

  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return yield* new LinkParseError({
      message: "YouTube API key not configured",
      url,
    });
  }

  const data = yield* fetchJson(
    {
      label: "YouTube API",
      link: url,
      url: `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails,snippet&key=${apiKey}`,
    },
    youtubeVideosResponse
  );

  const item = data.items[0];
  if (!item) {
    return yield* new LinkParseError({
      message: "YouTube video not found",
      url,
    });
  }

  const result: LinkMeta & { provider: "youtube" } = {
    channelName: item.snippet.channelTitle,
    description: item.snippet.description,
    durationSeconds: roundToNearest15Min(
      parseIsoDuration(item.contentDetails.duration)
    ),
    fetchedAt: new Date().toISOString(),
    provider: "youtube",
    thumbnailUrl:
      item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.default?.url,
    title: item.snippet.title,
    url,
  };

  return result;
});

export const youtubeResolver: LinkResolver = {
  matches: (url) => parseYoutubeVideoId(url.href) !== null,
  pluginId: "youtube",
  resolve: parseYoutubeLink,
};
