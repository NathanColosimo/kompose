"use client";

import type { ParsedTask, TagOption } from "@kompose/task-parser/parser";
import { connectTaskParser } from "@kompose/task-parser/worker-client";
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Temporal } from "temporal-polyfill";

/** Live parser state; previous results remain visible while newer text is parsed. */
export interface MagicParse {
  /**
   * "off": no text, the model is unavailable, or parsing failed.
   * "reading": running; `task` is the result for earlier text, if any.
   */
  status: "off" | "reading" | "done";
  task: ParsedTask | null;
}

/**
 * Share one model across app windows without blocking typing.
 * See documents/command-bar.md for worker loading and failure behavior.
 */
function loadParser() {
  const worker = new SharedWorker(
    new URL("./task-parser.worker.ts", import.meta.url),
    { name: "task-parser", type: "module" }
  );
  // A worker whose script can't load only fires `error`; the port never
  // hears, so without this `load` would wait forever.
  const failedToStart = new Promise<never>((_, reject) => {
    worker.addEventListener(
      "error",
      () => reject(new Error("The task parser worker failed to start")),
      { once: true }
    );
  });
  return Promise.race([connectTaskParser(worker.port), failedToStart]);
}

const parserQuery = queryOptions({
  gcTime: Number.POSITIVE_INFINITY,
  queryFn: loadParser,
  queryKey: ["task-parser", "model"],
  retry: 1,
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * Loads the model as soon as the app mounts, so it's ready before the
 * command bar opens.
 */
export function usePreloadTaskParser() {
  useQuery(parserQuery);
}

function parseQuery(text: string, tags: TagOption[]) {
  // Relative phrases ("tomorrow", "in 2 hours") depend on the current time.
  const minute = Math.floor(Date.now() / 60_000);
  return queryOptions({
    gcTime: 60_000,
    queryFn: async ({ client }) => {
      const parser = await client.fetchQuery(parserQuery);
      return parser.parse({ now: Temporal.Now.zonedDateTimeISO(), tags, text });
    },
    queryKey: ["task-parser", "parse", minute, tags, text],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Parses `text` (if any) with the user's tags for the live preview.
 * `resolve` returns the parse for submit, waiting for the model if it is
 * still loading.
 */
export function useMagicTask(text: string, tags: TagOption[]) {
  const queryClient = useQueryClient();
  const { data: parser } = useQuery(parserQuery);
  const query = useQuery({
    ...parseQuery(text, tags),
    enabled: parser !== undefined && text !== "",
    placeholderData: keepPreviousData,
  });

  const resolve = async (): Promise<ParsedTask | null> => {
    if (!text) {
      return null;
    }
    try {
      return await queryClient.fetchQuery(parseQuery(text, tags));
    } catch {
      return null;
    }
  };

  let parse: MagicParse = { status: "off", task: null };
  if (parser && text && !query.isError) {
    const task = query.data ?? null;
    const done = task && !(query.isFetching || query.isPlaceholderData);
    parse = { status: done ? "done" : "reading", task };
  }
  return { parse, resolve };
}
