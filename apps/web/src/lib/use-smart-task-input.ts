"use client";

import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  isSmartTaskInputAvailable,
  type SmartTaskInput,
  smartParseTaskInput,
} from "@/lib/smart-task-input";

/**
 * Where on-device parsing stands for the current text. `result` is null when
 * the model answered nothing usable.
 */
export type SmartParse =
  /** No model, or the input isn't sent to it. */
  | { status: "off" }
  /** Running; `previous` is the last result, for earlier text. */
  | { status: "reading"; previous: SmartTaskInput | null }
  | { status: "done"; result: SmartTaskInput | null };

/** How long typing must pause before the model runs for the preview. */
const DEBOUNCE_MS = 300;
/** Enter waits at most this long for the model before creating without it. */
const SUBMIT_TIMEOUT_MS = 3000;

const availabilityQuery = queryOptions({
  gcTime: Number.POSITIVE_INFINITY,
  queryFn: isSmartTaskInputAvailable,
  queryKey: ["smart-task-input", "availability"],
  staleTime: Number.POSITIVE_INFINITY,
});

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

/**
 * One query per (text, tags). The debounce lives in the query function:
 * React Query aborts the signal once typing moves on to a new key, so a
 * superseded request stops before (or while) the model runs. The tags are
 * part of the key because they change the schema.
 */
function parseQuery(text: string, tagNames: string[]) {
  return queryOptions({
    gcTime: 60_000,
    queryFn: async ({ signal }) => {
      await wait(DEBOUNCE_MS, signal);
      return smartParseTaskInput(text, { signal, tagNames });
    },
    queryKey: ["smart-task-input", "parse", tagNames, text],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * On-device parsing of `text` for the live preview. `resolve` returns the
 * result for submit, reusing the in-flight request. Pass null to skip parsing
 * (for example, when explicit tokens are present).
 */
export function useSmartTaskInput(text: string | null, tagNames: string[]) {
  const queryClient = useQueryClient();
  const { data: available = false } = useQuery(availabilityQuery);
  const enabled = available && text !== null;
  const query = useQuery({
    ...parseQuery(text ?? "", tagNames),
    enabled,
    placeholderData: keepPreviousData,
  });

  const resolve = async () => {
    if (!(available && text !== null)) {
      return null;
    }
    const timeout = new Promise<null>((done) =>
      setTimeout(() => done(null), SUBMIT_TIMEOUT_MS)
    );
    const parsed = queryClient
      .fetchQuery(parseQuery(text, tagNames))
      .catch(() => null);
    return await Promise.race([parsed, timeout]);
  };

  let parse: SmartParse = { status: "off" };
  if (enabled) {
    const data = query.data ?? null;
    parse =
      query.isFetching || query.isPlaceholderData
        ? { previous: data, status: "reading" }
        : { result: data, status: "done" };
  }

  return { available, parse, resolve };
}
