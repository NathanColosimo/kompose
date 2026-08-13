import {
  type TagSelect,
  tagSelectSchemaWithIcon,
} from "@kompose/api/routers/tag/contract";
import { atom } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig } from "../config";

export const TAGS_QUERY_KEY = ["tags", "list"] as const;

export const tagsQueryAtom = atomWithQuery<TagSelect[]>((get) => {
  const { orpc } = getStateConfig(get);

  return {
    queryKey: TAGS_QUERY_KEY,
    queryFn: async () => {
      const tags = await orpc.tags.list();
      return tags.map((tag) => tagSelectSchemaWithIcon.parse(tag));
    },
    staleTime: 1000 * 60 * 5,
  };
});

export const tagsDataAtom = atom((get) => get(tagsQueryAtom).data ?? []);
