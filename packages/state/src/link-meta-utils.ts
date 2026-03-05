import type { LinkMeta } from "@kompose/api/routers/task/contract";

const PROVIDER_LABELS: Record<string, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  substack: "Substack",
  unknown: "Link",
};

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? "Link";
}

export function getLinkDurationMinutes(meta: LinkMeta): number | null {
  return "durationSeconds" in meta && meta.durationSeconds > 0
    ? Math.ceil(meta.durationSeconds / 60)
    : null;
}

export function getLinkWordCount(meta: LinkMeta): number | null {
  return "wordCount" in meta && meta.wordCount > 0 ? meta.wordCount : null;
}

/** Deduplicate links by URL — later entries win when URLs collide */
export function dedupeLinks(links: LinkMeta[]): LinkMeta[] {
  const map = new Map<string, LinkMeta>();
  for (const link of links) {
    map.set(link.url, link);
  }
  return [...map.values()];
}

export const URL_REGEX = /^https?:\/\/\S+$/;
