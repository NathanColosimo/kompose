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
// Zod schemas for Spotify API responses
// ============================================================================

const SPOTIFY_URL =
  /^https?:\/\/open\.spotify\.com\/(track|episode|show|album)\/([a-zA-Z0-9]+)/;

/** The resource type and ID in an open.spotify.com URL */
function parseSpotifyUrl(url: string): {
  resourceType: "track" | "episode" | "show" | "album";
  id: string;
} | null {
  const match = url.match(SPOTIFY_URL);
  if (!(match?.[1] && match[2])) {
    return null;
  }
  return {
    id: match[2],
    resourceType: match[1] as "track" | "episode" | "show" | "album",
  };
}

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

  if (!(clientId && clientSecret)) {
    return yield* new LinkParseError({
      message: "Spotify API credentials not configured",
      url: "",
    });
  }

  const token = yield* fetchJson(
    {
      init: {
        body: "grant_type=client_credentials",
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
      label: "Spotify token",
      link: "",
      url: "https://accounts.spotify.com/api/token",
    },
    spotifyTokenResponse
  );
  return token.access_token;
});

/** Fetch metadata for a Spotify track, episode, or show */
const parseSpotifyLink = Effect.fn("Spotify.parseLink")(function* (
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
  const request = {
    init: { headers: { Authorization: `Bearer ${accessToken}` } },
    link: url,
    url: `https://api.spotify.com/v1/${apiPathMap[parsed.resourceType]}`,
  };

  if (parsed.resourceType === "album") {
    const album = yield* fetchJson(
      { ...request, label: "Spotify album" },
      spotifyAlbumResponse
    );
    const totalMs = album.tracks.items.reduce(
      (sum, t) => sum + t.duration_ms,
      0
    );

    return {
      artistName: album.artists?.[0]?.name,
      description: undefined,
      durationSeconds: roundToNearest15Min(Math.round(totalMs / 1000)),
      fetchedAt: new Date().toISOString(),
      provider: "spotify" as const,
      resourceType: "album" as const,
      thumbnailUrl: album.images?.[0]?.url,
      title: album.name,
      url,
    };
  }

  const resource = yield* fetchJson(
    { ...request, label: "Spotify resource" },
    spotifyResourceResponse
  );
  const artistName =
    resource.artists?.[0]?.name ?? resource.show?.name ?? resource.publisher;

  return {
    artistName,
    description: resource.description,
    durationSeconds: roundToNearest15Min(
      Math.round(resource.duration_ms / 1000)
    ),
    fetchedAt: new Date().toISOString(),
    provider: "spotify" as const,
    resourceType: parsed.resourceType,
    thumbnailUrl: resource.images?.[0]?.url,
    title: resource.name,
    url,
  };
});

export const spotifyResolver: LinkResolver = {
  matches: (url) => parseSpotifyUrl(url.href) !== null,
  pluginId: "spotify",
  resolve: parseSpotifyLink,
};
