import type { AppRouterClient } from "@kompose/api/routers/index";
import { tagSelectSchemaWithIcon } from "@kompose/api/routers/tag/contract";
import { atom } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig } from "../config";

export const TAGS_QUERY_KEY = ["tags", "list"] as const;

/** Tags query shared by the atom below and `useTags`. */
export function tagsQueryOptions(orpc: AppRouterClient) {
  return {
    queryFn: async () => {
      const tags = await orpc.tags.list();
      return tags.map((tag) => tagSelectSchemaWithIcon.parse(tag));
    },
    queryKey: TAGS_QUERY_KEY,
    staleTime: 1000 * 60 * 5,
  };
}

export const tagsQueryAtom = atomWithQuery((get) =>
  tagsQueryOptions(getStateConfig(get).orpc)
);

export const tagsDataAtom = atom((get) => get(tagsQueryAtom).data ?? []);
