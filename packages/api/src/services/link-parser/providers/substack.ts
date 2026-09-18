import type { LinkMeta } from "@kompose/db/schema/link";
import { Effect, Result } from "effect";
import { z } from "zod";
import { LinkParseError, roundToNearest15Min } from "../types";

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
const HTML_POST_ID_PATTERNS = [
  /\\?"post_id\\?":\s*(\d+)/,
  /\\?"postId\\?":\s*(\d+)/,
  /post_preview\/(\d+)\//,
  /\/i\/(\d+)\?img=/,
] as const;
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

function extractHtmlPostId(html: string): string | null {
  for (const pattern of HTML_POST_ID_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/** Fetch a post by numeric ID via the direct by-id endpoint */
const fetchPostById = Effect.fn("Substack.fetchPostById")(function* (
  url: string,
  postId: string
) {
  const response = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to fetch Substack post by ID",
        url,
      }),
    try: () => fetch(`https://substack.com/api/v1/posts/by-id/${postId}`),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      message: `Substack post-by-id API returned ${response.status}`,
      url,
    });
  }

  const json = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to parse Substack post-by-id response",
        url,
      }),
    try: () => response.json(),
  });

  const data = postByIdResponseSchema.safeParse(json);
  if (!data.success) {
    return yield* new LinkParseError({
      message: `Invalid Substack post-by-id response: ${data.error.message}`,
      url,
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
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to fetch Substack archive API",
        url,
      }),
    try: () => fetch(apiUrl),
  });

  if (!response.ok) {
    return yield* new LinkParseError({
      message: `Substack archive API returned ${response.status}`,
      url,
    });
  }

  const json = yield* Effect.tryPromise({
    catch: (cause) =>
      new LinkParseError({
        cause,
        message: "Failed to parse Substack archive response",
        url,
      }),
    try: () => response.json(),
  });

  const data = archiveResponseSchema.safeParse(json);
  if (!data.success) {
    return yield* new LinkParseError({
      message: `Invalid Substack archive response: ${data.error.message}`,
      url,
    });
  }

  const post = data.data.find((p) => p.slug === slug);
  if (!post) {
    return yield* new LinkParseError({
      message: `Post with slug "${slug}" not found in archive results`,
      url,
    });
  }

  return { post };
});

/** Fetch the public page HTML and extract an embedded post ID as a fallback */
const fetchPostIdFromHtml = Effect.fn("Substack.fetchPostIdFromHtml")(
  function* (url: string) {
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new LinkParseError({
          cause,
          message: "Failed to fetch Substack post HTML",
          url,
        }),
      try: () => fetch(url),
    });

    if (!response.ok) {
      return yield* new LinkParseError({
        message: `Substack post HTML returned ${response.status}`,
        url,
      });
    }

    const html = yield* Effect.tryPromise({
      catch: (cause) =>
        new LinkParseError({
          cause,
          message: "Failed to read Substack post HTML",
          url,
        }),
      try: () => response.text(),
    });

    const postId = extractHtmlPostId(html);
    if (!postId) {
      return yield* new LinkParseError({
        message: "Could not extract Substack post ID from HTML",
        url,
      });
    }

    return postId;
  }
);

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
    authorName: publication?.name,
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
      message: "Could not extract post slug or ID from Substack URL",
      url,
    });
  }

  const baseUrl = extractBaseUrl(url);
  if (!baseUrl) {
    return yield* new LinkParseError({
      message: "Could not extract base URL from Substack URL",
      url,
    });
  }

  const slugResult = yield* Effect.result(fetchPostBySlug(url, baseUrl, slug));
  if (Result.isSuccess(slugResult)) {
    return postToLinkMeta(slugResult.success.post);
  }

  const postId = yield* fetchPostIdFromHtml(url);
  const data = yield* fetchPostById(url, postId);
  return postToLinkMeta(data.post, data.publication);
});
