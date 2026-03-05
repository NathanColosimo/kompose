import { z } from "zod";

// ============================================================================
// LINK META SCHEMA (Zod discriminated union for JSONB column)
// ============================================================================

const spotifyLinkMeta = z.object({
  provider: z.literal("spotify"),
  resourceType: z.enum(["track", "episode", "show", "album"]),
  title: z.string(),
  description: z.string().optional(),
  durationSeconds: z.number(),
  thumbnailUrl: z.url().optional(),
  artistName: z.string().optional(),
  url: z.url(),
  fetchedAt: z.string(),
});

const youtubeLinkMeta = z.object({
  provider: z.literal("youtube"),
  title: z.string(),
  description: z.string().optional(),
  durationSeconds: z.number(),
  thumbnailUrl: z.url().optional(),
  channelName: z.string().optional(),
  url: z.url(),
  fetchedAt: z.string(),
});

const substackLinkMeta = z.object({
  provider: z.literal("substack"),
  title: z.string(),
  description: z.string().optional(),
  durationSeconds: z.number(),
  wordCount: z.number(),
  thumbnailUrl: z.url().optional(),
  authorName: z.string().optional(),
  url: z.url(),
  fetchedAt: z.string(),
});

const unknownLinkMeta = z.object({
  provider: z.literal("unknown"),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnailUrl: z.url().optional(),
  url: z.url(),
  fetchedAt: z.string(),
});

/** Link metadata - discriminated union by provider type */
export const linkMetaSchema = z.discriminatedUnion("provider", [
  spotifyLinkMeta,
  youtubeLinkMeta,
  substackLinkMeta,
  unknownLinkMeta,
]);

export type LinkMeta = z.infer<typeof linkMetaSchema>;
