import type { Activity, DayData } from "@kompose/api/routers/days/contract";
import { getPluginForProvider } from "@kompose/plugins";
import { atom } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig } from "../config";
import { currentDateAtom } from "./current-date";
import { linkedAccountsDataAtom } from "./google-data";

export const DAY_DATA_QUERY_KEY = ["days"] as const;

/** One day's numbers, by metric. */
export type DayMetrics = Partial<
  Record<DayData["metrics"][number]["metric"], number>
>;
export type WorkoutActivity = Extract<Activity, { kind: "workout" }>;

const EMPTY_METRICS_BY_DAY = new Map<string, DayMetrics>();
const EMPTY_ACTIVITIES: Activity[] = [];

/**
 * The accounts of plugins that record day data, such as WHOOP, as one string
 * for the query key. Empty when the user linked none, and then nothing is
 * fetched.
 */
const dayDataAccountsAtom = atom((get) =>
  get(linkedAccountsDataAtom)
    .filter((account) => getPluginForProvider(account.providerId)?.dayData)
    .map((account) => account.id)
    .sort()
    .join(",")
);

/** Whether the user linked a plugin that records day data. */
export const hasDayDataAtom = atom((get) => get(dayDataAccountsAtom) !== "");

/**
 * Month-anchored window with ±7 day padding so a week view straddling a
 * month boundary still has data for both months.
 */
const dayDataWindowAtom = atom((get) => {
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

const dayDataQueryAtom = atomWithQuery<DayData>((get) => {
  const { orpc } = getStateConfig(get);
  const accounts = get(dayDataAccountsAtom);
  const { startDate, endDate } = get(dayDataWindowAtom);

  return {
    enabled: accounts !== "",
    // The last month stays on screen while the next loads, but never
    // another account's.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === accounts ? previousData : undefined,
    queryFn: () => orpc.days.list({ endDate, startDate }),
    queryKey: [...DAY_DATA_QUERY_KEY, accounts, startDate, endDate] as const,
    staleTime: 10 * 60 * 1000,
  };
});

const dayDataAtom = atom((get) =>
  get(hasDayDataAtom) ? get(dayDataQueryAtom).data : undefined
);

/** Each day's numbers. Keys are dates in YYYY-MM-DD format. */
export const dayMetricsByDayAtom = atom((get) => {
  const data = get(dayDataAtom);
  if (!data) {
    return EMPTY_METRICS_BY_DAY;
  }
  const byDay = new Map<string, DayMetrics>();
  for (const { date, metric, value } of data.metrics) {
    const day = byDay.get(date) ?? {};
    day[metric] = value;
    byDay.set(date, day);
  }
  return byDay;
});

const activitiesAtom = atom(
  (get) => get(dayDataAtom)?.activities ?? EMPTY_ACTIVITIES
);

export const sleepsAtom = atom((get) =>
  get(activitiesAtom).filter((activity) => activity.kind === "sleep")
);

export const workoutsAtom = atom((get) =>
  get(activitiesAtom).filter((activity) => activity.kind === "workout")
);

/** Whether a day has a number its header shows. */
export function hasDayStats(metrics: DayMetrics | undefined): boolean {
  return (
    metrics?.recovery_score !== undefined ||
    metrics?.strain !== undefined ||
    metrics?.sleep_duration_min !== undefined
  );
}

/**
 * Whether day headers keep a stats row: while a plugin that records day data
 * is linked, or when any visible day has stats. Keeping it while linked stops
 * the grid moving when paging to days without data.
 */
export function shouldShowDayStatsRow(
  hasDayData: boolean,
  dayKeys: string[],
  metricsByDay: Map<string, DayMetrics>
): boolean {
  return (
    hasDayData || dayKeys.some((key) => hasDayStats(metricsByDay.get(key)))
  );
}
