import type { LinkMeta } from "@kompose/api/routers/task/contract";
import { useQueries } from "@tanstack/react-query";
import { useStateConfig } from "../config";

export function useLinkMetadata(links: (string | LinkMeta)[]) {
  const { orpc } = useStateConfig();
  const urls = [
    ...new Set(
      links.flatMap((link) => {
        if (typeof link === "string") {
          return [link];
        }
        return link.provider === "unknown" && !link.title ? [link.url] : [];
      })
    ),
  ];
  return useQueries({
    combine: (results) =>
      results.map((result, index) => ({
        data: result.data,
        isPending: result.isPending,
        url: urls[index],
      })),
    queries: urls.map((url) => ({
      queryFn: ({ signal }) => orpc.tasks.parseLink({ url }, { signal }),
      queryKey: ["link-meta", url],
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
}
