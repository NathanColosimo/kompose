import { z } from "zod";

// ============================================================================
// LINK META SCHEMA (Zod discriminated union for JSONB column)
// ============================================================================

const spotifyLinkMeta = z.object({
  artistName: z.string().optional(),
  description: z.string().optional(),
  durationSeconds: z.number(),
  fetchedAt: z.string(),
  provider: z.literal("spotify"),
  resourceType: z.enum(["track", "episode", "show", "album"]),
  thumbnailUrl: z.url().optional(),
  title: z.string(),
  url: z.url(),
});

const youtubeLinkMeta = z.object({
  channelName: z.string().optional(),
  description: z.string().optional(),
  durationSeconds: z.number(),
  fetchedAt: z.string(),
  provider: z.literal("youtube"),
  thumbnailUrl: z.url().optional(),
  title: z.string(),
  url: z.url(),
});

const substackLinkMeta = z.object({
  authorName: z.string().optional(),
  description: z.string().optional(),
  durationSeconds: z.number(),
  fetchedAt: z.string(),
  provider: z.literal("substack"),
  thumbnailUrl: z.url().optional(),
  title: z.string(),
  url: z.url(),
  wordCount: z.number(),
});

const unknownLinkMeta = z.object({
  description: z.string().optional(),
  fetchedAt: z.string(),
  provider: z.literal("unknown"),
  thumbnailUrl: z.url().optional(),
  title: z.string().optional(),
  url: z.url(),
});

/** Link metadata - discriminated union by provider type */
export const linkMetaSchema = z.discriminatedUnion("provider", [
  spotifyLinkMeta,
  youtubeLinkMeta,
  substackLinkMeta,
  unknownLinkMeta,
]);

export type LinkMeta = z.infer<typeof linkMetaSchema>;
