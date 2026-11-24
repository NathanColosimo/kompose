import type { LinkMeta } from "@kompose/db/schema/link";
import { Effect } from "effect";
import { HttpClientRequest } from "effect/http";
import { z } from "zod";
import { fetchJson } from "../fetch";
import {
  LinkParseError,
  type LinkResolver,
  roundToNearest15Min,
} from "../types";

// ============================================================================
// Zod schemas for Substack API responses
// ============================================================================

const audioItemSchema = z.object({
  audio_url: z.string().nullable(),
  duration: z.number().optional(),
  post_id: z.number(),
  type: z.string(),
  voice_id: z.string(),
});

export const PublicationSchema = z.object({
  author_id: z.number(),
  custom_domain: z
    .preprocess((val) => {
      if (typeof val === "string") {
        if (val.startsWith("http")) {
          return val;
        }
        return `https://${val}/`;
      }
      return val;
    }, z.url())
    .nullish(),
  id: z.number(),
  logo_url: z.string().nullish(),
  name: z.string(),
  subdomain: z.string(),
});

const postSchema = z.object({
  audio_items: z.array(audioItemSchema).optional(),
  canonical_url: z.string(),
  comment_count: z.number(),
  cover_image: z.string().nullable().optional(),
  description: z.string(),
  id: z.number(),
  post_date: z.string(),
  publication_id: z.number(),
  reaction_count: z.number(),
  slug: z.string(),
  subtitle: z.string().nullable().optional(),
  title: z.string(),
  truncated_body_text: z.string().nullable().optional(),
  type: z.union([
    z.literal("newsletter"),
    z.literal("podcast"),
    z.literal("thread"),
  ]),
  wordcount: z.number().optional(),
});

const postBySlugResponseSchema = z.object({ id: z.number() });

const postByIdResponseSchema = z.object({
  post: postSchema,
  publication: PublicationSchema,
});

const SUBSTACK_SLUG_PATTERN = /\/p\/(?<slug>[a-z0-9-]+)/u;
const INBOX_POST_ID_PATTERN = /\/inbox\/post\/(?<postId>\d+)/u;
const HOME_POST_ID_PATTERN = /\/home\/post\/p-(?<postId>\d+)/u;
const WORDS_PER_MINUTE = 238;

function extractSlug(url: string): string | null {
  const match = url.match(SUBSTACK_SLUG_PATTERN);
  return match?.[1] ?? null;
}

function extractInboxPostId(url: string): string | null {
  const match = url.match(INBOX_POST_ID_PATTERN);
  return match?.[1] ?? null;
}

function extractHomePostId(url: string): string | null {
  const match = url.match(HOME_POST_ID_PATTERN);
  return match?.[1] ?? null;
}

function extractQueryPostId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // An empty `post_id=` falls through to the ID in the path.
    return parsed.searchParams.get("post_id") || null;
  } catch {
    return null;
  }
}

const fetchPostById = Effect.fn("Substack.fetchPostById")(function* (
  url: string,
  postId: string
) {
  return yield* fetchJson(
    {
      label: "Substack post-by-id API",
      link: url,
      request: HttpClientRequest.get(
        `https://substack.com/api/v1/posts/by-id/${postId}`
      ),
    },
    postByIdResponseSchema
  );
});

/** The ID of the post at `/p/<slug>` on the publication's own domain. */
const fetchPostIdBySlug = Effect.fn("Substack.fetchPostIdBySlug")(function* (
  url: string,
  slug: string
) {
  const post = yield* fetchJson(
    {
      label: "Substack post-by-slug API",
      link: url,
      request: HttpClientRequest.get(
        `${new URL(url).origin}/api/v1/posts/${slug}`
      ),
    },
    postBySlugResponseSchema
  );
  return String(post.id);
});

function postToLinkMeta(
  post: z.infer<typeof postSchema>,
  publication: z.infer<typeof PublicationSchema>
): LinkMeta & { provider: "substack" } {
  const voiceover = post.audio_items?.find((a) => a.type === "voiceover");
  const wordCount = post.wordcount ?? 0;

  let durationSeconds: number;
  if (voiceover?.duration) {
    durationSeconds = roundToNearest15Min(voiceover.duration);
  } else {
    durationSeconds = roundToNearest15Min(
      Math.ceil((wordCount / WORDS_PER_MINUTE) * 60)
    );
  }

  return {
    authorName: publication.name,
    description: post.description,
    durationSeconds,
    fetchedAt: new Date().toISOString(),
    provider: "substack",
    thumbnailUrl: post.cover_image ?? undefined,
    title: post.title,
    url: post.canonical_url,
    wordCount,
  };
}

/**
 * Every link ends at the post-by-id API. The ID comes from the URL (query,
 * inbox or home path), or from the publication's post-by-slug API.
 * See documents/link-parsing.md.
 */
const parseSubstackLink = Effect.fn("Substack.parseLink")(function* (
  url: string
) {
  let postId =
    extractQueryPostId(url) ??
    extractInboxPostId(url) ??
    extractHomePostId(url);
  if (!postId) {
    const slug = extractSlug(url);
    if (!slug) {
      return yield* new LinkParseError({
        message: "Could not extract post slug or ID from Substack URL",
        url,
      });
    }
    postId = yield* fetchPostIdBySlug(url, slug);
  }

  const data = yield* fetchPostById(url, postId);
  return postToLinkMeta(data.post, data.publication);
});

const SUBSTACK_HOST = /^[a-z0-9-]+\.substack\.com$/u;
const SUBSTACK_POST_PATH = /^\/(?:inbox\/post\/|home\/post\/p-)/u;

/** Custom domains that host Substack publications. Add hostnames as needed. */
const SUBSTACK_CUSTOM_DOMAINS = new Set([
  "blog.ai-futures.org",
  "blog.redwoodresearch.org",
  "www.gurwinder.blog",
  "www.interconnects.ai",
  "newsletter.forethought.org",
  "www.normaltech.ai",
]);

export const substackResolver: LinkResolver = {
  matches: (url) =>
    SUBSTACK_HOST.test(url.hostname) ||
    (url.hostname === "substack.com" &&
      SUBSTACK_POST_PATH.test(url.pathname)) ||
    SUBSTACK_CUSTOM_DOMAINS.has(url.hostname) ||
    // Substack email and share links on any domain carry the post ID
    url.searchParams.has("post_id"),
  resolve: parseSubstackLink,
};
