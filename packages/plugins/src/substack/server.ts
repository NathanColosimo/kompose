import type { LinkMeta } from "@kompose/db/schema/link";
import { Effect, Result } from "effect";
import { z } from "zod";
import {
  fetchJson,
  fetchText,
  LinkParseError,
  type LinkResolver,
  roundToNearest15Min,
} from "../link-resolver";

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

const postByIdResponseSchema = z.object({
  post: postSchema,
  publication: PublicationSchema,
});

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

function extractQueryPostId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // An empty `post_id=` falls through to the ID in the path.
    return parsed.searchParams.get("post_id") || null;
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

const fetchPostById = Effect.fn("Substack.fetchPostById")(function* (
  url: string,
  postId: string
) {
  return yield* fetchJson(
    {
      label: "Substack post-by-id API",
      link: url,
      url: `https://substack.com/api/v1/posts/by-id/${postId}`,
    },
    postByIdResponseSchema
  );
});

const fetchPostBySlug = Effect.fn("Substack.fetchPostBySlug")(function* (
  url: string,
  baseUrl: string,
  slug: string
) {
  const posts = yield* fetchJson(
    {
      label: "Substack archive API",
      link: url,
      url: `${baseUrl}/api/v1/archive?sort=top&search=${slug}&offset=0&limit=20`,
    },
    archiveResponseSchema
  );

  const post = posts.find((p) => p.slug === slug);
  if (!post) {
    return yield* new LinkParseError({
      message: `Post with slug "${slug}" not found in archive results`,
      url,
    });
  }

  return { post };
});

const fetchPostIdFromHtml = Effect.fn("Substack.fetchPostIdFromHtml")(
  function* (url: string) {
    const html = yield* fetchText({
      label: "Substack post HTML",
      link: url,
      url,
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
const parseSubstackLink = Effect.fn("Substack.parseLink")(function* (
  url: string
) {
  // Query param post_id (custom domain / share links), inbox/post links with
  // the numeric ID in the path, or home/post links in p-{id} format
  const postId =
    extractQueryPostId(url) ??
    extractInboxPostId(url) ??
    extractHomePostId(url);
  if (postId) {
    const data = yield* fetchPostById(url, postId);
    return postToLinkMeta(data.post, data.publication);
  }

  // Publication post links use the slug via archive search
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

  const htmlPostId = yield* fetchPostIdFromHtml(url);
  const data = yield* fetchPostById(url, htmlPostId);
  return postToLinkMeta(data.post, data.publication);
});

const SUBSTACK_HOST = /^[a-z0-9-]+\.substack\.com$/;
const SUBSTACK_POST_PATH = /^\/(?:inbox\/post\/|home\/post\/p-)/;

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
  pluginId: "substack",
  resolve: parseSubstackLink,
};
