import type { LinkProvider } from "../types";

const SPOTIFY_PATTERN =
  /^https?:\/\/open\.spotify\.com\/(track|episode|show|album)\//;
const YOUTUBE_WATCH_PATTERN = /^https?:\/\/(www\.)?youtube\.com\/watch/;
const YOUTUBE_SHORT_URL_PATTERN = /^https?:\/\/youtu\.be\//;
const YOUTUBE_SHORTS_PATTERN = /^https?:\/\/(www\.)?youtube\.com\/shorts\//;
const SUBSTACK_PATTERN = /^https?:\/\/[a-z0-9-]+\.substack\.com\//;
const SUBSTACK_INBOX_PATTERN = /^https?:\/\/substack\.com\/inbox\/post\//;
const SUBSTACK_HOME_POST_PATTERN = /^https?:\/\/substack\.com\/home\/post\/p-/;

/** Known custom domains that host Substack publications */
const SUBSTACK_CUSTOM_DOMAINS = [
  "blog.ai-futures.org",
  "blog.redwoodresearch.org",
  "www.gurwinder.blog",
  "www.interconnects.ai",
  "newsletter.forethought.org",
  "www.normaltech.ai",
];

/** Check if URL has Substack-specific query params (post_id) */
function hasSubstackQueryParams(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has("post_id");
  } catch {
    return false;
  }
}

/** Check if URL hostname matches a known Substack custom domain */
function isSubstackCustomDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SUBSTACK_CUSTOM_DOMAINS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

const SPOTIFY_URL_PARSE =
  /open\.spotify\.com\/(track|episode|show|album)\/([a-zA-Z0-9]+)/;
const YOUTUBE_WATCH_ID = /[?&]v=([a-zA-Z0-9_-]{11})/;
const YOUTUBE_SHORT_URL_ID = /youtu\.be\/([a-zA-Z0-9_-]{11})/;
const YOUTUBE_SHORTS_ID = /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/;

/** Detect provider from URL hostname/path patterns */
export function detectProvider(url: string): LinkProvider {
  if (SPOTIFY_PATTERN.test(url)) {
    return "spotify";
  }
  if (
    YOUTUBE_WATCH_PATTERN.test(url) ||
    YOUTUBE_SHORT_URL_PATTERN.test(url) ||
    YOUTUBE_SHORTS_PATTERN.test(url)
  ) {
    return "youtube";
  }
  if (
    SUBSTACK_PATTERN.test(url) ||
    SUBSTACK_INBOX_PATTERN.test(url) ||
    SUBSTACK_HOME_POST_PATTERN.test(url) ||
    isSubstackCustomDomain(url) ||
    hasSubstackQueryParams(url)
  ) {
    return "substack";
  }
  return "unknown";
}

/** Extract Spotify resource type and ID from an open.spotify.com URL */
export function parseSpotifyUrl(url: string): {
  resourceType: "track" | "episode" | "show" | "album";
  id: string;
} | null {
  const match = url.match(SPOTIFY_URL_PARSE);
  if (!match?.[1]) {
    return null;
  }
  if (!match[2]) {
    return null;
  }
  return {
    resourceType: match[1] as "track" | "episode" | "show" | "album",
    id: match[2],
  };
}

/** Extract YouTube video ID from various URL formats */
export function parseYoutubeVideoId(url: string): string | null {
  const watchMatch = url.match(YOUTUBE_WATCH_ID);
  if (watchMatch?.[1]) {
    return watchMatch[1];
  }

  const shortMatch = url.match(YOUTUBE_SHORT_URL_ID);
  if (shortMatch?.[1]) {
    return shortMatch[1];
  }

  const shortsMatch = url.match(YOUTUBE_SHORTS_ID);
  if (shortsMatch?.[1]) {
    return shortsMatch[1];
  }

  return null;
}
