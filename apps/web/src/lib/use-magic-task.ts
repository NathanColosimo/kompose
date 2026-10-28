"use client";

import type { ParsedTask, TagOption } from "@kompose/task-parser/parser";
import { createWorkerTaskParser } from "@kompose/task-parser/worker-client";
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

/**
 * The magic box: a small on-device model (packages/task-parser) labels the
 * text and code resolves the labels into task fields. Parsing takes a few
 * milliseconds in a Worker, so it runs on every keystroke without a debounce.
 */
export type MagicParse =
  /** The model isn't loaded yet, or the input isn't sent to it. */
  | { status: "off" }
  /** Running; `previous` is the result for earlier text. */
  | { status: "reading"; previous: ParsedTask | null }
  | { status: "done"; result: ParsedTask };

/** The parser runs in a Worker so a parse never blocks typing. */
async function loadParser() {
  const worker = new Worker(
    new URL("./task-parser.worker.ts", import.meta.url),
    { type: "module" }
  );
  try {
    return await createWorkerTaskParser(worker);
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

const parserQuery = queryOptions({
  gcTime: Number.POSITIVE_INFINITY,
  queryFn: loadParser,
  queryKey: ["task-parser", "model"],
  retry: 1,
  staleTime: Number.POSITIVE_INFINITY,
});

function parseQuery(text: string, tags: TagOption[]) {
  // Relative phrases ("tomorrow", "in 2 hours") depend on the current time.
  const minute = Math.floor(Date.now() / 60_000);
  return queryOptions({
    gcTime: 60_000,
    queryFn: async ({ client }) => {
      const parse = await client.fetchQuery(parserQuery);
      return parse(text, { tags });
    },
    queryKey: ["task-parser", "parse", minute, tags, text],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Parses `text` with the user's tags for the live preview. Pass null to skip
 * parsing (for example, when explicit tokens are typed). `resolve` returns the
 * parse for submit, waiting for the model if it is still loading.
 */
export function useMagicTask(text: string | null, tags: TagOption[]) {
  const queryClient = useQueryClient();
  const { data: parser } = useQuery(parserQuery);
  const query = useQuery({
    ...parseQuery(text ?? "", tags),
    enabled: parser !== undefined && text !== null,
    placeholderData: keepPreviousData,
  });

  const resolve = async (): Promise<ParsedTask | null> => {
    if (text === null) {
      return null;
    }
    try {
      return await queryClient.fetchQuery(parseQuery(text, tags));
    } catch {
      return null;
    }
  };

  let parse: MagicParse = { status: "off" };
  if (parser && text !== null && !query.isError) {
    const data = query.data ?? null;
    parse =
      data && !(query.isFetching || query.isPlaceholderData)
        ? { result: data, status: "done" }
        : { previous: data, status: "reading" };
  }
  return { parse, resolve };
}
