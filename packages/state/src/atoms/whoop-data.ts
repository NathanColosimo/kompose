import type { WhoopDaySummary } from "@kompose/api/routers/whoop/contract";
import { keepPreviousData } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { atom } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig, hasSessionAtom } from "../config";
import { WHOOP_DAYS_QUERY_KEY } from "../whoop-query-keys";
import { currentDateAtom, timezoneAtom } from "./current-date";
import { linkedAccountsDataAtom } from "./google-data";

// --- Account ---

/** The linked WHOOP account, or null if none linked. */
export const whoopAccountDataAtom = atom<Account | null>(
  (get) =>
    get(linkedAccountsDataAtom).find(
      (account) => account.providerId === "whoop"
    ) ?? null
);

export const whoopAccountIdAtom = atom<string | null>(
  (get) => get(whoopAccountDataAtom)?.accountId ?? null
);

// --- Day Summaries ---

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
  return { startDate, endDate };
});

const whoopSummariesQueryAtom = atomWithQuery<WhoopDaySummary[]>((get) => {
  const { orpc } = getStateConfig(get);
  const hasSession = get(hasSessionAtom);
  const accountId = get(whoopAccountIdAtom);
  const timeZone = get(timezoneAtom);
  const { startDate, endDate } = get(whoopWindowAtom);

  return {
    queryKey: [...WHOOP_DAYS_QUERY_KEY, accountId, startDate, endDate] as const,
    enabled: hasSession && !!accountId,
    queryFn: () => {
      if (!accountId) {
        throw new Error("No WHOOP account linked");
      }
      return orpc.whoop.days.list({
        accountId,
        startDate,
        endDate,
        timeZone,
      });
    },
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  };
});

/**
 * WHOOP day summaries keyed by YYYY-MM-DD date string.
 * Components read this directly via useAtomValue — no prop drilling needed.
 */
export const whoopSummariesByDayAtom = atom<Map<string, WhoopDaySummary>>(
  (get) => {
    const data = get(whoopSummariesQueryAtom).data;
    const map = new Map<string, WhoopDaySummary>();
    if (data) {
      for (const summary of data) {
        map.set(summary.day, summary);
      }
    }
    return map;
  }
);
