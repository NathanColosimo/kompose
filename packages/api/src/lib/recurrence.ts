import type { TaskRecurrence } from "@kompose/db/schema/task";
import { Temporal } from "temporal-polyfill";

/** Map of RRULE day abbreviations to Temporal dayOfWeek (1=Monday, 7=Sunday) */
const DAY_MAP: Record<string, number> = {
  FR: 5,
  MO: 1,
  SA: 6,
  SU: 7,
  TH: 4,
  TU: 2,
  WE: 3,
};

/** Safety cap when count is absent, even if an until date is set. */
const DEFAULT_MAX_OCCURRENCES = 52; // ~1 year of weekly occurrences

/**
 * Generate dates on or after startDate, stopping at the count (or safety cap)
 * or the inclusive until date, whichever comes first.
 */
export function generateOccurrences(
  recurrence: TaskRecurrence,
  startDate: Temporal.PlainDate
): Temporal.PlainDate[] {
  const limit = recurrence.count ?? DEFAULT_MAX_OCCURRENCES;

  const untilDate = recurrence.until
    ? Temporal.PlainDate.from(recurrence.until)
    : null;

  const occurrences: Temporal.PlainDate[] = [];

  switch (recurrence.freq) {
    case "DAILY":
      generateDaily(
        occurrences,
        startDate,
        recurrence.interval,
        limit,
        untilDate
      );
      break;
    case "WEEKLY":
      generateWeekly(
        occurrences,
        startDate,
        recurrence.interval,
        recurrence.byDay,
        limit,
        untilDate
      );
      break;
    case "MONTHLY":
      generateMonthly(
        occurrences,
        startDate,
        recurrence.interval,
        recurrence.byMonthDay,
        limit,
        untilDate
      );
      break;
    case "YEARLY":
      generateYearly(
        occurrences,
        startDate,
        recurrence.interval,
        limit,
        untilDate
      );
      break;
    default:
      throw new Error("Unsupported recurrence frequency");
  }

  return occurrences;
}

function shouldStop(
  occurrences: Temporal.PlainDate[],
  limit: number,
  current: Temporal.PlainDate,
  untilDate: Temporal.PlainDate | null
): boolean {
  if (occurrences.length >= limit) {
    return true;
  }
  if (untilDate && Temporal.PlainDate.compare(current, untilDate) > 0) {
    return true;
  }
  return false;
}

function generateDaily(
  occurrences: Temporal.PlainDate[],
  startDate: Temporal.PlainDate,
  interval: number,
  limit: number,
  untilDate: Temporal.PlainDate | null
): void {
  let current = startDate;

  while (!shouldStop(occurrences, limit, current, untilDate)) {
    occurrences.push(current);
    current = current.add({ days: interval });
  }
}

function generateWeekly(
  occurrences: Temporal.PlainDate[],
  startDate: Temporal.PlainDate,
  interval: number,
  byDay: string[],
  limit: number,
  untilDate: Temporal.PlainDate | null
): void {
  const targetDays = byDay
    .map((d) => DAY_MAP[d])
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);

  // Find the Monday of the start week
  const startDayOfWeek = startDate.dayOfWeek;
  const weekStart = startDate.subtract({ days: startDayOfWeek - 1 });

  let currentWeekStart = weekStart;

  while (!shouldStop(occurrences, limit, currentWeekStart, untilDate)) {
    for (const dayOfWeek of targetDays) {
      const date = currentWeekStart.add({ days: dayOfWeek - 1 });

      if (Temporal.PlainDate.compare(date, startDate) < 0) {
        continue;
      }

      if (shouldStop(occurrences, limit, date, untilDate)) {
        return;
      }

      occurrences.push(date);
    }

    currentWeekStart = currentWeekStart.add({ weeks: interval });
  }
}

function generateMonthly(
  occurrences: Temporal.PlainDate[],
  startDate: Temporal.PlainDate,
  interval: number,
  byMonthDay: number,
  limit: number,
  untilDate: Temporal.PlainDate | null
): void {
  let currentMonth = startDate.with({ day: 1 });

  while (!shouldStop(occurrences, limit, currentMonth, untilDate)) {
    // Handle months with fewer days than byMonthDay
    const daysInMonth = currentMonth.daysInMonth;
    const actualDay = Math.min(byMonthDay, daysInMonth);
    const date = currentMonth.with({ day: actualDay });

    if (Temporal.PlainDate.compare(date, startDate) >= 0) {
      if (shouldStop(occurrences, limit, date, untilDate)) {
        return;
      }
      occurrences.push(date);
    }

    currentMonth = currentMonth.add({ months: interval });
  }
}

function generateYearly(
  occurrences: Temporal.PlainDate[],
  startDate: Temporal.PlainDate,
  interval: number,
  limit: number,
  untilDate: Temporal.PlainDate | null
): void {
  let current = startDate;

  while (!shouldStop(occurrences, limit, current, untilDate)) {
    occurrences.push(current);
    // Handle Feb 29 on non-leap years by using constrain
    current = current.add({ years: interval });
  }
}
