import type { LinkMeta } from "@kompose/api/routers/task/contract";
import { useQueries } from "@tanstack/react-query";
import { useStateConfig } from "../config";
import { linkMetadataQueryOptions } from "../link-metadata";

/** One independently observed, cancellable metadata query per URL. */
export function useLinkMetadata(links: (string | LinkMeta)[], active = true) {
  const { orpc } = useStateConfig();
  const byUrl = new Map<string, string | LinkMeta>();
  for (const link of active ? links : []) {
    byUrl.set(typeof link === "string" ? link : link.url, link);
  }
  const uniqueUrls = [...byUrl.keys()];
  return useQueries({
    combine: (results) =>
      results.map((result, index) => ({
        data: result.data,
        error: result.error,
        isPending: result.isPending,
        refetch: result.refetch,
        url: uniqueUrls[index],
      })),
    queries: [...byUrl].map(([url, link]) =>
      linkMetadataQueryOptions(
        orpc.tasks.parseLink,
        url,
        typeof link === "string" ? undefined : link
      )
    ),
  });
}
