import type { WhoopDaySummary } from "@kompose/api/routers/whoop/contract";
import type { Account } from "better-auth";
import { atom } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig } from "../config";
import { currentDateAtom, timezoneAtom } from "./current-date";
import { linkedAccountsDataAtom } from "./google-data";

const WHOOP_DAYS_QUERY_KEY = ["whoop", "days"] as const;
const EMPTY_SUMMARIES_BY_DAY = new Map<string, WhoopDaySummary>();

export const whoopAccountDataAtom = atom<Account | null>(
  (get) =>
    get(linkedAccountsDataAtom).find(
      (account) => account.providerId === "whoop"
    ) ?? null
);

export const whoopAccountIdAtom = atom<string | null>(
  (get) => get(whoopAccountDataAtom)?.accountId ?? null
);

/**
 * Month-anchored window with ±7 day padding so a week view straddling a
 * month boundary still has WHOOP data for both months.
 */
const whoopWindowAtom = atom((get) => {
  const currentDate = get(currentDateAtom);
  const startDate = currentDate
    .with({ day: 1 })
    .subtract({ days: 7 })
    .toString();
  const endDate = currentDate
    .with({ day: currentDate.daysInMonth })
    .add({ days: 7 })
    .toString();
  return { endDate, startDate };
});

const whoopSummariesQueryAtom = atomWithQuery<WhoopDaySummary[]>((get) => {
  const { orpc } = getStateConfig(get);
  const accountId = get(whoopAccountIdAtom);
  const timeZone = get(timezoneAtom);
  const { startDate, endDate } = get(whoopWindowAtom);

  return {
    enabled: Boolean(accountId),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === accountId &&
      previousQuery?.queryKey[3] === timeZone
        ? previousData
        : undefined,
    queryFn: () => {
      if (!accountId) {
        throw new Error("No WHOOP account linked");
      }
      return orpc.whoop.days.list({
        accountId,
        endDate,
        startDate,
        timeZone,
      });
    },
    queryKey: [
      ...WHOOP_DAYS_QUERY_KEY,
      accountId,
      timeZone,
      startDate,
      endDate,
    ] as const,
    staleTime: 10 * 60 * 1000,
  };
});

const whoopSummariesDataAtom = atom((get) => {
  if (!get(whoopAccountIdAtom)) {
    return;
  }
  return get(whoopSummariesQueryAtom).data;
});

/** Keys are local dates in YYYY-MM-DD format. */
export const whoopSummariesByDayAtom = atom<Map<string, WhoopDaySummary>>(
  (get) => {
    const data = get(whoopSummariesDataAtom);
    if (!data) {
      return EMPTY_SUMMARIES_BY_DAY;
    }
    return new Map(data.map((summary) => [summary.day, summary]));
  }
);
