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
  artists: z.array(z.object({ name: z.string() })).optional(),
  description: z.string().optional(),
  duration_ms: z.number(),
  images: z.array(z.object({ url: z.string() })).optional(),
  name: z.string(),
  publisher: z.string().optional(),
  show: z.object({ name: z.string() }).optional(),
});

const spotifyAlbumResponse = z.object({
  artists: z.array(z.object({ name: z.string() })).optional(),
  images: z.array(z.object({ url: z.string() })).optional(),
  name: z.string(),
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
      message: "Spotify API credentials not configured",
      url: "",
    });
  }
  if (!clientSecret) {
    return yield* new LinkParseError({
      message: "Spotify API credentials not configured",
      url: "",
    });
  }

  const response = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to fetch Spotify access token",
        url: "",
      }),
    try: () =>
      fetch("https://accounts.spotify.com/api/token", {
        body: "grant_type=client_credentials",
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      message: `Spotify token request failed: ${response.status}`,
      url: "",
    });
  }

  const json = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to parse Spotify token response",
        url: "",
      }),
    try: () => response.json(),
  });

  const parsed = spotifyTokenResponse.safeParse(json);
  if (!parsed.success) {
    return yield* new LinkParseError({
      message: `Invalid Spotify token response: ${parsed.error.message}`,
      url: "",
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
      message: "Could not parse Spotify URL",
      url,
    });
  }

  const accessToken = yield* getSpotifyAccessToken();

  const apiPathMap = {
    album: `albums/${parsed.id}`,
    episode: `episodes/${parsed.id}`,
    show: `shows/${parsed.id}`,
    track: `tracks/${parsed.id}`,
  } as const;
  const apiPath = apiPathMap[parsed.resourceType];

  const response = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to fetch Spotify metadata",
        url,
      }),
    try: () =>
      fetch(`https://api.spotify.com/v1/${apiPath}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      message: `Spotify API returned ${response.status}`,
      url,
    });
  }

  const json = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to parse Spotify response",
        url,
      }),
    try: () => response.json(),
  });

  if (parsed.resourceType === "album") {
    const data = spotifyAlbumResponse.safeParse(json);
    if (!data.success) {
      return yield* new LinkParseError({
        message: `Invalid Spotify album response: ${data.error.message}`,
        url,
      });
    }

    const totalMs = data.data.tracks.items.reduce(
      (sum, t) => sum + t.duration_ms,
      0
    );

    return {
      artistName: data.data.artists?.[0]?.name,
      description: undefined,
      durationSeconds: roundToNearest15Min(Math.round(totalMs / 1000)),
      fetchedAt: new Date().toISOString(),
      provider: "spotify" as const,
      resourceType: "album" as const,
      thumbnailUrl: data.data.images?.[0]?.url,
      title: data.data.name,
      url,
    };
  }

  const data = spotifyResourceResponse.safeParse(json);
  if (!data.success) {
    return yield* new LinkParseError({
      message: `Invalid Spotify resource response: ${data.error.message}`,
      url,
    });
  }

  const artistName =
    data.data.artists?.[0]?.name ?? data.data.show?.name ?? data.data.publisher;

  return {
    artistName,
    description: data.data.description,
    durationSeconds: roundToNearest15Min(
      Math.round(data.data.duration_ms / 1000)
    ),
    fetchedAt: new Date().toISOString(),
    provider: "spotify" as const,
    resourceType: parsed.resourceType,
    thumbnailUrl: data.data.images?.[0]?.url,
    title: data.data.name,
    url,
  };
});
