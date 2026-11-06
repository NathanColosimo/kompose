import type { LinkMeta } from "@kompose/api/routers/task/contract";
import { queryOptions } from "@tanstack/react-query";
import type { StateConfig } from "./config";
import { getLinkDurationMinutes } from "./link-meta-utils";

export interface LinkEditedFields {
  durationMinutes: boolean;
  title: boolean;
}

interface LinkDraft {
  durationMinutes: number;
  links: LinkMeta[];
  title: string;
}

/** Enrich the current draft, preserving fields the user has set. */
export function applyLinkMetadata<T extends LinkDraft>(
  draft: T,
  url: string,
  meta: LinkMeta,
  edited?: LinkEditedFields
): T {
  if (!draft.links.some((link) => link.url === url)) {
    return draft;
  }
  const isFirst = draft.links[0]?.url === url;
  const duration = getLinkDurationMinutes(meta);
  const title =
    isFirst && !edited?.title && !draft.title.trim() && meta.title
      ? meta.title
      : draft.title;
  const durationMinutes =
    isFirst && !edited?.durationMinutes && duration !== null
      ? duration
      : draft.durationMinutes;
  const links = draft.links.map((link) => (link.url === url ? meta : link));
  if (
    title === draft.title &&
    durationMinutes === draft.durationMinutes &&
    links.every((link, index) => link === draft.links[index])
  ) {
    return draft;
  }
  return { ...draft, durationMinutes, links, title };
}

export function getLinkMetadataQueryKey(url: string) {
  return ["link-meta", url] as const;
}

export function linkMetadataQueryOptions(
  parseLink: StateConfig["orpc"]["tasks"]["parseLink"],
  url: string,
  initialData?: LinkMeta
) {
  return queryOptions({
    initialData:
      initialData && (initialData.provider !== "unknown" || initialData.title)
        ? initialData
        : undefined,
    queryFn: ({ signal }) => parseLink({ url }, { signal }),
    queryKey: getLinkMetadataQueryKey(url),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
