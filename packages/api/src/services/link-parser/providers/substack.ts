import type { LinkMeta } from "@kompose/db/schema/link";
import { Effect } from "effect";
import { z } from "zod";
import { LinkParseError, roundToNearest15Min } from "../types";

// ============================================================================
// Zod schemas for Substack API responses
// ============================================================================

const audioItemSchema = z.object({
  post_id: z.number(),
  voice_id: z.string(),
  audio_url: z.string().nullable(),
  type: z.string(),
  duration: z.number().optional(),
});

export const PublicationSchema = z.object({
  id: z.number(),
  subdomain: z.string(),
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
  name: z.string(),
  logo_url: z.string().nullish(),
  author_id: z.number(),
});

const postSchema = z.object({
  id: z.number(),
  publication_id: z.number(),
  title: z.string(),
  slug: z.string(),
  post_date: z.string(),
  canonical_url: z.string(),
  type: z.union([
    z.literal("newsletter"),
    z.literal("podcast"),
    z.literal("thread"),
  ]),
  subtitle: z.string().nullable().optional(),
  cover_image: z.string().nullable().optional(),
  description: z.string(),
  truncated_body_text: z.string().nullable().optional(),
  wordcount: z.number().optional(),
  reaction_count: z.number(),
  comment_count: z.number(),
  audio_items: z.array(audioItemSchema).optional(),
});

const archiveResponseSchema = z.array(postSchema);

/** Response shape for the /api/v1/posts/by-id/{id} endpoint */
const postByIdResponseSchema = z.object({
  post: postSchema,
  publication: PublicationSchema,
});

// ============================================================================

const SUBSTACK_SLUG_PATTERN = /\/p\/([a-z0-9-]+)/;
const INBOX_POST_ID_PATTERN = /\/inbox\/post\/(\d+)/;
const HOME_POST_ID_PATTERN = /\/home\/post\/p-(\d+)/;
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

/** Extract post_id from URL query params (used by custom domain / share links) */
function extractQueryPostId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("post_id");
  } catch {
    return null;
  }
}

function extractBaseUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/** Fetch a post by numeric ID via the direct by-id endpoint */
const fetchPostById = Effect.fn("Substack.fetchPostById")(function* (
  url: string,
  postId: string
) {
  const response = yield* Effect.tryPromise({
    try: () => fetch(`https://substack.com/api/v1/posts/by-id/${postId}`),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to fetch Substack post by ID",
        cause,
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      url,
      message: `Substack post-by-id API returned ${response.status}`,
    });
  }

  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to parse Substack post-by-id response",
        cause,
      }),
  });

  const data = postByIdResponseSchema.safeParse(json);
  if (!data.success) {
    return yield* new LinkParseError({
      url,
      message: `Invalid Substack post-by-id response: ${data.error.message}`,
    });
  }

  return data.data;
});

/** Fetch a post by slug via the archive search endpoint */
const fetchPostBySlug = Effect.fn("Substack.fetchPostBySlug")(function* (
  url: string,
  baseUrl: string,
  slug: string
) {
  const apiUrl = `${baseUrl}/api/v1/archive?sort=top&search=${slug}&offset=0&limit=20`;

  const response = yield* Effect.tryPromise({
    try: () => fetch(apiUrl),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to fetch Substack archive API",
        cause,
      }),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      url,
      message: `Substack archive API returned ${response.status}`,
    });
  }

  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new LinkParseError({
        url,
        message: "Failed to parse Substack archive response",
        cause,
      }),
  });

  const data = archiveResponseSchema.safeParse(json);
  if (!data.success) {
    return yield* new LinkParseError({
      url,
      message: `Invalid Substack archive response: ${data.error.message}`,
    });
  }

  const post = data.data.find((p) => p.slug === slug);
  if (!post) {
    return yield* new LinkParseError({
      url,
      message: `Post with slug "${slug}" not found in archive results`,
    });
  }

  return { post };
});

/** Build LinkMeta from a resolved Substack post */
function postToLinkMeta(
  post: z.infer<typeof postSchema>,
  publication?: z.infer<typeof PublicationSchema>
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
    provider: "substack",
    title: post.title,
    description: post.description,
    durationSeconds,
    wordCount,
    thumbnailUrl: post.cover_image ?? undefined,
    authorName: publication?.name,
    url: post.canonical_url,
    fetchedAt: new Date().toISOString(),
  };
}

/** Fetch and parse a Substack post. Priority: query param post_id > inbox path ID > slug search */
export const parseSubstackLink = Effect.fn("Substack.parseLink")(function* (
  url: string
) {
  // 1. Query param post_id (custom domain / share links)
  const queryPostId = extractQueryPostId(url);
  if (queryPostId) {
    const data = yield* fetchPostById(url, queryPostId);
    return postToLinkMeta(data.post, data.publication);
  }

  // 2. Inbox/post links have a numeric ID directly in the path
  const inboxPostId = extractInboxPostId(url);
  if (inboxPostId) {
    const data = yield* fetchPostById(url, inboxPostId);
    return postToLinkMeta(data.post, data.publication);
  }

  // 3. Home/post links use p-{id} format
  const homePostId = extractHomePostId(url);
  if (homePostId) {
    const data = yield* fetchPostById(url, homePostId);
    return postToLinkMeta(data.post, data.publication);
  }

  // 4. Publication post links use the slug via archive search
  const slug = extractSlug(url);
  if (!slug) {
    return yield* new LinkParseError({
      url,
      message: "Could not extract post slug or ID from Substack URL",
    });
  }

  const baseUrl = extractBaseUrl(url);
  if (!baseUrl) {
    return yield* new LinkParseError({
      url,
      message: "Could not extract base URL from Substack URL",
    });
  }

  const post = yield* fetchPostBySlug(url, baseUrl, slug);
  return postToLinkMeta(post.post);
});
