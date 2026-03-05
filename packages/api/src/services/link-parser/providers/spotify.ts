import { env } from "@kompose/env";
import { Effect } from "effect";
import { z } from "zod";
import { LinkParseError, roundToNearest15Min } from "../types";
import { parseSpotifyUrl } from "./detect";

// ============================================================================
// Zod schemas for Spotify API responses
// ============================================================================

const spotifyTokenResponse = z.object({
  access_token: z.string(),
});

const spotifyResourceResponse = z.object({
  name: z.string(),
  description: z.string().optional(),
  duration_ms: z.number(),
  images: z.array(z.object({ url: z.string() })).optional(),
  artists: z.array(z.object({ name: z.string() })).optional(),
  show: z.object({ name: z.string() }).optional(),
  publisher: z.string().optional(),
});

const spotifyAlbumResponse = z.object({
  name: z.string(),
  images: z.array(z.object({ url: z.string() })).optional(),
  artists: z.array(z.object({ name: z.string() })).optional(),
  tracks: z.object({
    items: z.array(z.object({ duration_ms: z.number() })),
  }),
});

// ============================================================================

/**
 * Get a Spotify access token via client credentials flow.
 * No user auth needed — app-level read access is sufficient.
 */
const getSpotifyAccessToken = Effect.fn("Spotify.getAccessToken")(function* () {
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;

  if (!clientId) {
    return yield* new LinkParseError({
      url: "",
      message: "Spotify API credentials not configured",
    });
  }
  if (!clientSecret) {
    return yield* new LinkParseError({
      url: "",
      message: "Spotify API credentials not configured",
    });
  }

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: "grant_type=client_credentials",
      }),
    catch: (cause) =>
      new LinkParseError({
        url: "",
        message: "Failed to fetch Spotify access token",
        cause,
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      url: "",
      message: `Spotify token request failed: ${response.status}`,
    });
  }

  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new LinkParseError({
        url: "",
        message: "Failed to parse Spotify token response",
        cause,
      }),
  });

  const parsed = spotifyTokenResponse.safeParse(json);
  if (!parsed.success) {
    return yield* new LinkParseError({
      url: "",
      message: `Invalid Spotify token response: ${parsed.error.message}`,
    });
  }

  return parsed.data.access_token;
});

/** Fetch metadata for a Spotify track, episode, or show */
export const parseSpotifyLink = Effect.fn("Spotify.parseLink")(function* (
  url: string
) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) {
    return yield* new LinkParseError({
      url,
      message: "Could not parse Spotify URL",
    });
  }

  const accessToken = yield* getSpotifyAccessToken();

  const apiPathMap = {
    show: `shows/${parsed.id}`,
    episode: `episodes/${parsed.id}`,
    track: `tracks/${parsed.id}`,
    album: `albums/${parsed.id}`,
  } as const;
  const apiPath = apiPathMap[parsed.resourceType];

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`https://api.spotify.com/v1/${apiPath}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to fetch Spotify metadata",
        cause,
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      url,
      message: `Spotify API returned ${response.status}`,
    });
  }

  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to parse Spotify response",
        cause,
      }),
  });

  if (parsed.resourceType === "album") {
    const data = spotifyAlbumResponse.safeParse(json);
    if (!data.success) {
      return yield* new LinkParseError({
        url,
        message: `Invalid Spotify album response: ${data.error.message}`,
      });
    }

    const totalMs = data.data.tracks.items.reduce(
      (sum, t) => sum + t.duration_ms,
      0
    );

    return {
      provider: "spotify" as const,
      resourceType: "album" as const,
      title: data.data.name,
      description: undefined,
      durationSeconds: roundToNearest15Min(Math.round(totalMs / 1000)),
      thumbnailUrl: data.data.images?.[0]?.url,
      artistName: data.data.artists?.[0]?.name,
      url,
      fetchedAt: new Date().toISOString(),
    };
  }

  const data = spotifyResourceResponse.safeParse(json);
  if (!data.success) {
    return yield* new LinkParseError({
      url,
      message: `Invalid Spotify resource response: ${data.error.message}`,
    });
  }

  const artistName =
    data.data.artists?.[0]?.name ?? data.data.show?.name ?? data.data.publisher;

  return {
    provider: "spotify" as const,
    resourceType: parsed.resourceType,
    title: data.data.name,
    description: data.data.description,
    durationSeconds: roundToNearest15Min(
      Math.round(data.data.duration_ms / 1000)
    ),
    thumbnailUrl: data.data.images?.[0]?.url,
    artistName,
    url,
    fetchedAt: new Date().toISOString(),
  };
});
