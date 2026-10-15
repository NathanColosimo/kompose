import type { LinkMeta } from "@kompose/db/schema/link";
import { env } from "@kompose/env";
import { Effect } from "effect";
import { z } from "zod";
import { LinkParseError, roundToNearest15Min } from "../types";
import { parseYoutubeVideoId } from "./detect";

// ============================================================================
// Zod schemas for YouTube Data API v3 responses
// ============================================================================

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

// ============================================================================

const ISO_DURATION_PATTERN = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;

/** Convert ISO 8601 duration (PT1H2M10S) to total seconds */
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
export const parseYoutubeLink = Effect.fn("YouTube.parseLink")(function* (
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

  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails,snippet&key=${apiKey}`;

  const response = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to fetch YouTube metadata",
        url,
      }),
    try: () => fetch(apiUrl),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      message: `YouTube API returned ${response.status}`,
      url,
    });
  }

  const json = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to parse YouTube response",
        url,
      }),
    try: () => response.json(),
  });

  const data = youtubeVideosResponse.safeParse(json);
  if (!data.success) {
    return yield* new LinkParseError({
      message: `Invalid YouTube API response: ${data.error.message}`,
      url,
    });
  }

  const item = data.data.items[0];
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
