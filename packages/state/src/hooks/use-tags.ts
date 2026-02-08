import type {
  CreateTagInput,
  TagSelect,
  UpdateTagInput,
} from "@kompose/api/routers/tag/contract";
import { tagSelectSchemaWithIcon } from "@kompose/api/routers/tag/contract";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { TAGS_QUERY_KEY } from "../atoms/tags";
import { TASKS_QUERY_KEY } from "../atoms/tasks";
import { hasSessionAtom, useStateConfig } from "../config";

export function useTags() {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();
  const hasSession = useAtomValue(hasSessionAtom);

  const tagsQuery = useQuery({
    queryKey: TAGS_QUERY_KEY,
    enabled: hasSession,
    queryFn: async () => {
      const tags = await orpc.tags.list();
      return tags.map((tag) => tagSelectSchemaWithIcon.parse(tag));
    },
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });

  const createTag = useMutation({
    mutationFn: async (input: CreateTagInput) => {
      const tag = await orpc.tags.create(input);
      return tagSelectSchemaWithIcon.parse(tag);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<TagSelect[]>(TAGS_QUERY_KEY, (old) => {
        const next = [...(old ?? []), created];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
    },
  });

  const deleteTag = useMutation({
    mutationFn: async (id: string) => await orpc.tags.delete({ id }),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<TagSelect[]>(TAGS_QUERY_KEY, (old) =>
        (old ?? []).filter((tag) => tag.id !== id)
      );
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    },
  });

  const updateTag = useMutation({
    mutationFn: async (input: UpdateTagInput) => {
      const tag = await orpc.tags.update(input);
      return tagSelectSchemaWithIcon.parse(tag);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<TagSelect[]>(TAGS_QUERY_KEY, (old) => {
        const next = (old ?? []).map((tag) =>
          tag.id === updated.id ? updated : tag
        );
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    },
  });

  return { tagsQuery, createTag, updateTag, deleteTag };
}
