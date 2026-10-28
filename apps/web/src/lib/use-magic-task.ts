"use client";

import type { ParsedTask, TagOption } from "@kompose/task-parser/parser";
import {
  createWorkerTaskParser,
  type RemoteTaskParser,
} from "@kompose/task-parser/worker-client";
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Temporal } from "temporal-polyfill";

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
async function loadParser(): Promise<RemoteTaskParser> {
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

function parseQuery(
  parse: RemoteTaskParser | undefined,
  text: string,
  tags: TagOption[]
) {
  // Relative phrases ("tomorrow", "in 2 hours") depend on the current time.
  const minute = Temporal.Now.plainDateTimeISO()
    .round({ roundingMode: "floor", smallestUnit: "minute" })
    .toString();
  return queryOptions({
    enabled: parse !== undefined,
    gcTime: 60_000,
    queryFn: () => {
      if (!parse) {
        throw new Error("Task parser not loaded");
      }
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
    ...parseQuery(parser, text ?? "", tags),
    enabled: parser !== undefined && text !== null,
    placeholderData: keepPreviousData,
  });

  const resolve = async (): Promise<ParsedTask | null> => {
    if (text === null) {
      return null;
    }
    try {
      const loaded = await queryClient.fetchQuery(parserQuery);
      return await queryClient.fetchQuery(parseQuery(loaded, text, tags));
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
