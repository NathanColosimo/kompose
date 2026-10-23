"use client";

import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Temporal } from "temporal-polyfill";
import {
  type ParsedTaskInput,
  resolveTokenDates,
} from "@/lib/task-input-parser";

function tokenDatesQuery(
  dueDateRaw: string | null,
  startDateRaw: string | null
) {
  // Relative phrases ("tomorrow") change meaning at midnight.
  const today = Temporal.Now.plainDateISO().toString();
  return queryOptions({
    gcTime: 60_000,
    queryFn: () => resolveTokenDates({ dueDateRaw, startDateRaw }),
    queryKey: ["token-dates", today, dueDateRaw, startDateRaw],
    staleTime: 60_000,
  });
}

/** `typed` with the dates of its >due and ~start tokens resolved. */
function withTokenDates(
  typed: ParsedTaskInput,
  dates: Awaited<ReturnType<typeof resolveTokenDates>> | undefined
): ParsedTaskInput {
  return {
    ...typed,
    dueDate: typed.dueDateRaw ? (dates?.dueDate ?? null) : null,
    startDate: typed.startDateRaw ? (dates?.startDate ?? null) : null,
    startTime: typed.startDateRaw ? (dates?.startTime ?? null) : null,
  };
}

/**
 * Resolves the >due and ~start tokens of `typed`. Resolution is async (the
 * parser loads on first use) but takes about a millisecond, so the previous
 * dates stay on screen in between instead of flickering away. `resolve`
 * returns the input with final dates, for submit.
 */
export function useTokenDates(typed: ParsedTaskInput) {
  const queryClient = useQueryClient();
  const { dueDateRaw, startDateRaw } = typed;
  const enabled = dueDateRaw !== null || startDateRaw !== null;
  const query = useQuery({
    ...tokenDatesQuery(dueDateRaw, startDateRaw),
    enabled,
    placeholderData: keepPreviousData,
  });

  const resolve = async () =>
    enabled
      ? withTokenDates(
          typed,
          await queryClient.fetchQuery(
            tokenDatesQuery(dueDateRaw, startDateRaw)
          )
        )
      : typed;

  return {
    parsed: withTokenDates(typed, enabled ? query.data : undefined),
    pending: enabled && (query.isFetching || query.isPlaceholderData),
    resolve,
  };
}
