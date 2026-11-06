import type { WhoopCachedDayRaw } from "@kompose/whoop/schema";
import { Temporal } from "temporal-polyfill";

const SHORT_CACHE_TTL_SECONDS = 15 * 60;
const SETTLED_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function ttlForDay(
  payload: WhoopCachedDayRaw,
  timeZone: string,
  now: Temporal.Instant
): number {
  const today = now.toZonedDateTimeISO(timeZone).toPlainDate().toString();
  const cycleEnded =
    payload.cycle?.end &&
    Temporal.Instant.compare(Temporal.Instant.from(payload.cycle.end), now) <=
      0;

  const hasRecoverySleep =
    payload.recovery?.cycle_id === payload.cycle?.id &&
    payload.sleeps.some(
      (sleep) =>
        sleep.id === payload.recovery?.sleep_id &&
        sleep.cycle_id === payload.cycle?.id
    );
  const recordsSettled = [
    payload.cycle,
    payload.recovery,
    ...payload.sleeps,
    ...payload.workouts,
  ].every(
    (record) =>
      !record ||
      record.score_state === "SCORED" ||
      record.score_state === "UNSCORABLE"
  );

  return payload.day < today && cycleEnded && hasRecoverySleep && recordsSettled
    ? SETTLED_CACHE_TTL_SECONDS
    : SHORT_CACHE_TTL_SECONDS;
}

export function missingDayFetchRanges(params: {
  cachedDays: ReadonlyMap<string, WhoopCachedDayRaw>;
  days: string[];
  timeZone: string;
}): { days: string[]; end: string; start: string }[] {
  const missingDays = params.days.filter((day) => !params.cachedDays.has(day));
  const ranges: [string, ...string[]][] = [];
  for (const day of missingDays) {
    const range = ranges.at(-1);
    const previous = range?.at(-1);
    if (
      range &&
      previous &&
      Temporal.PlainDate.from(previous).add({ days: 1 }).toString() === day
    ) {
      range.push(day);
    } else {
      ranges.push([day]);
    }
  }

  return ranges.map((days) => ({
    days,
    end: Temporal.PlainDate.from(days.at(-1) ?? days[0])
      .toZonedDateTime({ plainTime: "00:00", timeZone: params.timeZone })
      .add({ days: 1 })
      .toInstant()
      .toString(),
    // WHOOP cycles and overnight sleeps can start the previous evening.
    start: Temporal.PlainDate.from(days[0])
      .toZonedDateTime({ plainTime: "00:00", timeZone: params.timeZone })
      .subtract({ hours: 6 })
      .toInstant()
      .toString(),
  }));
}
