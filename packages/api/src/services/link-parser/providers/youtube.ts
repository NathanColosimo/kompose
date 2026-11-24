import type { LinkMeta } from "@kompose/db/schema/link";
import { env } from "@kompose/env";
import { Effect, Redacted } from "effect";
import { HttpClientRequest } from "effect/http";
import { z } from "zod";
import { fetchJson } from "../fetch";
import { LinkParseError, roundToNearest15Min } from "../types";
import { parseYoutubeVideoId } from "./detect";

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

const ISO_DURATION_PATTERN =
  /PT(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?(?:(?<seconds>\d+)S)?/u;

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

  const data = yield* fetchJson(
    {
      label: "YouTube API",
      link: url,
      request: HttpClientRequest.get(
        "https://www.googleapis.com/youtube/v3/videos",
        {
          urlParams: {
            id: videoId,
            // Redacted, so the key stays out of spans and error messages.
            key: Redacted.make(apiKey),
            part: "contentDetails,snippet",
          },
        }
      ),
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
