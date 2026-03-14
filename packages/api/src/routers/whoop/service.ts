import { auth } from "@kompose/auth";
import { createWhoopClient } from "@kompose/whoop/client";
import type {
  WhoopCachedDayRaw,
  WhoopCycle,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
} from "@kompose/whoop/schema";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import {
  logAndSwallowWhoopCacheError,
  logWhoopCacheErrorAndFallback,
  WhoopCacheService,
} from "./cache";
import type { WhoopDaySummary, WhoopProfile } from "./contract";
import { whoopDaySummarySchema } from "./contract";
import { WhoopAccountNotLinkedError, WhoopInvalidRangeError } from "./errors";

const MAX_RANGE_DAYS = 62;
const TODAY_CACHE_TTL_SECONDS = 15 * 60;
const PAST_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

function dateFromOffset(dateTime: string, offset: string): string {
  return Temporal.Instant.from(dateTime)
    .toZonedDateTimeISO(offset)
    .toPlainDate()
    .toString();
}

function inclusiveDays(startDate: string, endDate: string): string[] {
  const start = Temporal.PlainDate.from(startDate);
  const end = Temporal.PlainDate.from(endDate);
  const days: string[] = [];

  for (
    let current = start;
    Temporal.PlainDate.compare(current, end) <= 0;
    current = current.add({ days: 1 })
  ) {
    days.push(current.toString());
  }

  return days;
}

const validateRange = Effect.fn("WhoopService.validateRange")(function* (
  startDate: string,
  endDate: string,
  timeZone: string
) {
  const start = Temporal.PlainDate.from(startDate);
  const end = Temporal.PlainDate.from(endDate);

  if (Temporal.PlainDate.compare(start, end) > 0) {
    return yield* new WhoopInvalidRangeError({
      message: "startDate must be on or before endDate",
    });
  }

  const totalDays = start.until(end).days + 1;
  if (totalDays > MAX_RANGE_DAYS) {
    return yield* new WhoopInvalidRangeError({
      message: `WHOOP day range cannot exceed ${MAX_RANGE_DAYS} days`,
    });
  }

  Temporal.Now.zonedDateTimeISO(timeZone);
});

function selectPrimarySleep(payload: WhoopCachedDayRaw): WhoopSleep | null {
  if (payload.sleeps.length === 0) {
    return null;
  }

  if (payload.recovery?.sleep_id) {
    const byRecovery = payload.sleeps.find(
      (sleep) => sleep.id === payload.recovery?.sleep_id
    );
    if (byRecovery) {
      return byRecovery;
    }
  }

  const nonNapSleeps = payload.sleeps.filter((sleep) => !sleep.nap);
  const candidateSleeps =
    nonNapSleeps.length > 0 ? nonNapSleeps : [...payload.sleeps];

  const sortedSleeps = candidateSleeps.sort((left, right) => {
    const leftDuration =
      Temporal.Instant.from(left.end).epochMilliseconds -
      Temporal.Instant.from(left.start).epochMilliseconds;
    const rightDuration =
      Temporal.Instant.from(right.end).epochMilliseconds -
      Temporal.Instant.from(right.start).epochMilliseconds;

    return rightDuration - leftDuration;
  });

  return sortedSleeps[0] ?? null;
}

function totalSleepMilliseconds(sleep: WhoopSleep): number {
  const summary = sleep.score?.stage_summary;
  if (summary) {
    const total =
      (summary.total_light_sleep_time_milli ?? 0) +
      (summary.total_slow_wave_sleep_time_milli ?? 0) +
      (summary.total_rem_sleep_time_milli ?? 0);
    if (total > 0) {
      return total;
    }

    if ((summary.total_in_bed_time_milli ?? 0) > 0) {
      return summary.total_in_bed_time_milli ?? 0;
    }
  }

  return Math.max(
    0,
    Temporal.Instant.from(sleep.end).epochMilliseconds -
      Temporal.Instant.from(sleep.start).epochMilliseconds
  );
}

function toSummary(payload: WhoopCachedDayRaw): WhoopDaySummary {
  const primarySleep = selectPrimarySleep(payload);

  return whoopDaySummarySchema.parse({
    day: payload.day,
    cycleId: payload.cycle?.id ?? null,
    recoveryScore: payload.recovery?.score?.recovery_score ?? null,
    strainScore: payload.cycle?.score?.strain ?? null,
    kilojoule: payload.cycle?.score?.kilojoule ?? null,
    sleepPerformance: primarySleep?.score?.sleep_performance_percentage ?? null,
    sleep: primarySleep
      ? {
          id: primarySleep.id,
          start: primarySleep.start,
          end: primarySleep.end,
          totalSleepMilliseconds: totalSleepMilliseconds(primarySleep),
        }
      : null,
    naps: payload.sleeps
      .filter((sleep) => sleep.nap)
      .map((nap) => ({
        id: nap.id,
        start: nap.start,
        end: nap.end,
        totalSleepMilliseconds: totalSleepMilliseconds(nap),
      })),
    workouts: [...payload.workouts]
      .sort((left, right) => left.start.localeCompare(right.start))
      .map((workout) => ({
        id: workout.id,
        sportId: workout.sport_id ?? null,
        sportName: workout.sport_name || null,
        start: workout.start,
        end: workout.end,
        strainScore: workout.score?.strain ?? null,
      })),
  });
}

function initializeDay(day: string): WhoopCachedDayRaw {
  return {
    day,
    cycle: null,
    recovery: null,
    sleeps: [],
    workouts: [],
  };
}

function chooseMoreRecent<
  T extends {
    updated_at: string;
  },
>(current: T | null, candidate: T): T {
  if (!current) {
    return candidate;
  }

  return candidate.updated_at >= current.updated_at ? candidate : current;
}

function cycleDay(cycle: WhoopCycle): string {
  return dateFromOffset(cycle.start, cycle.timezone_offset);
}

/**
 * Determine the display day for a sleep. Uses the sleep END time
 * (wake-up moment), matching how the WHOOP app shows sleep on the
 * day you wake up rather than the day you fell asleep.
 */
function sleepDisplayDay(sleep: WhoopSleep): string {
  return dateFromOffset(sleep.end, sleep.timezone_offset);
}

function fallbackDayFromWorkout(workout: WhoopWorkout): string {
  return dateFromOffset(workout.start, workout.timezone_offset);
}

function workoutBelongsToCycle(
  workout: WhoopWorkout,
  cycle: WhoopCycle
): boolean {
  const workoutStart = Temporal.Instant.from(workout.start);
  const cycleStart = Temporal.Instant.from(cycle.start);
  const cycleEnd = cycle.end
    ? Temporal.Instant.from(cycle.end)
    : cycleStart.add({ hours: 36 });

  return (
    Temporal.Instant.compare(workoutStart, cycleStart) >= 0 &&
    Temporal.Instant.compare(workoutStart, cycleEnd) <= 0
  );
}

/**
 * Groups raw WHOOP data by calendar day using a cycle-centric approach.
 *
 * Each cycle anchors a bundle of associated records (matched by cycle_id):
 * - Cycle start day gets: cycle (strain/kilojoule) + workouts
 * - Wake-up day (sleep end) gets: recovery + sleep
 *
 * For normal consecutive days these differ by 1. For gap days (band off),
 * the cycle start day may be earlier — gap days in between will have no
 * cycle data, which matches the API limitation.
 */
function groupRawDataByDay(params: {
  cycles: WhoopCycle[];
  recoveries: WhoopRecovery[];
  sleeps: WhoopSleep[];
  workouts: WhoopWorkout[];
}): Map<string, WhoopCachedDayRaw> {
  const byDay = new Map<string, WhoopCachedDayRaw>();

  const ensureDay = (day: string) => {
    const existing = byDay.get(day);
    if (existing) {
      return existing;
    }

    const created = initializeDay(day);
    byDay.set(day, created);
    return created;
  };

  // Build lookups keyed by cycle_id
  const recoveryByCycleId = new Map(
    params.recoveries.map((r) => [r.cycle_id, r])
  );
  const sleepsByCycleId = new Map<number, WhoopSleep[]>();
  for (const sleep of params.sleeps) {
    const bucket = sleepsByCycleId.get(sleep.cycle_id);
    if (bucket) {
      bucket.push(sleep);
    } else {
      sleepsByCycleId.set(sleep.cycle_id, [sleep]);
    }
  }

  const assignedWorkoutIds = new Set<string>();

  for (const cycle of params.cycles) {
    const recovery = recoveryByCycleId.get(cycle.id);
    const cycleSleeps = sleepsByCycleId.get(cycle.id) ?? [];
    const cycleWorkouts = params.workouts.filter((w) =>
      workoutBelongsToCycle(w, cycle)
    );
    for (const w of cycleWorkouts) {
      assignedWorkoutIds.add(w.id);
    }

    // Assign everything to the wake-up day. WHOOP cycles start when
    // you fall asleep (~11pm), so the cycle start is the previous
    // calendar day. The actual day of activity is determined by when
    // you wake up (sleep end time within the cycle).
    const primarySleep =
      cycleSleeps.find((s) => !s.nap) ?? cycleSleeps[0] ?? null;

    let displayDay: string;
    if (primarySleep) {
      displayDay = sleepDisplayDay(primarySleep);
    } else if (cycle.end) {
      displayDay = cycleDay(cycle);
    } else {
      // Active cycle (no end, no sleep yet). Use current date in the
      // cycle's timezone so it lands on TODAY, not yesterday. Without
      // this, cycles starting ~11pm get assigned to the previous day
      // via cycleDay, polluting yesterday's cache entry.
      displayDay = Temporal.Now.instant()
        .toZonedDateTimeISO(cycle.timezone_offset)
        .toPlainDate()
        .toString();
    }

    const target = ensureDay(displayDay);
    target.cycle = chooseMoreRecent(target.cycle, cycle);
    if (recovery) {
      target.recovery = chooseMoreRecent(target.recovery, recovery);
    }
    for (const sleep of cycleSleeps) {
      target.sleeps.push(sleep);
    }
    for (const workout of cycleWorkouts) {
      target.workouts.push(workout);
    }
  }

  // Orphan workouts that didn't match any cycle
  for (const workout of params.workouts) {
    if (assignedWorkoutIds.has(workout.id)) {
      continue;
    }
    const day = fallbackDayFromWorkout(workout);
    const target = ensureDay(day);
    target.workouts.push(workout);
  }

  return byDay;
}

function ttlForDay(day: string, timeZone: string): number {
  const today = Temporal.Now.plainDateISO(timeZone);
  const current = Temporal.PlainDate.from(day);

  return Temporal.PlainDate.compare(current, today) === 0
    ? TODAY_CACHE_TTL_SECONDS
    : PAST_CACHE_TTL_SECONDS;
}

const checkWhoopAccountIsLinked = Effect.fn("checkWhoopAccountIsLinked")(
  function* (userId: string, accountId: string) {
    yield* Effect.annotateCurrentSpan("userId", userId);
    yield* Effect.annotateCurrentSpan("accountId", accountId);

    const token = yield* Effect.tryPromise({
      try: () =>
        auth.api.getAccessToken({
          body: {
            accountId,
            userId,
            providerId: "whoop",
          },
        }),
      catch: (cause) =>
        new WhoopAccountNotLinkedError({
          accountId,
          message: "WHOOP account not linked or token unavailable",
          cause,
        }),
    });

    if (!token.accessToken) {
      return yield* new WhoopAccountNotLinkedError({
        accountId,
        message: "WHOOP account not linked or token unavailable",
        cause: null,
      });
    }

    return token.accessToken;
  }
);

export class WhoopService extends Effect.Service<WhoopService>()(
  "WhoopService",
  {
    accessors: true,
    dependencies: [WhoopCacheService.Default],
    effect: Effect.gen(function* () {
      const cache = yield* WhoopCacheService;

      const listDaySummaries = Effect.fn("WhoopService.listDaySummaries")(
        function* (params: {
          accountId: string;
          endDate: string;
          startDate: string;
          timeZone: string;
          userId: string;
        }) {
          yield* Effect.annotateCurrentSpan("accountId", params.accountId);
          yield* Effect.annotateCurrentSpan("userId", params.userId);
          yield* Effect.annotateCurrentSpan("startDate", params.startDate);
          yield* Effect.annotateCurrentSpan("endDate", params.endDate);
          yield* Effect.annotateCurrentSpan("timeZone", params.timeZone);

          yield* validateRange(
            params.startDate,
            params.endDate,
            params.timeZone
          );

          const accessToken = yield* checkWhoopAccountIsLinked(
            params.userId,
            params.accountId
          );

          const requestedDays = inclusiveDays(params.startDate, params.endDate);
          const cachedDays = yield* cache
            .getCachedDays(params.accountId, requestedDays)
            .pipe(
              logWhoopCacheErrorAndFallback(
                new Map<string, WhoopCachedDayRaw>()
              )
            );

          const missingDays = requestedDays.filter(
            (day) => !cachedDays.has(day)
          );
          const allDays = new Map(cachedDays);

          if (missingDays.length > 0) {
            const client = createWhoopClient(accessToken);
            const missingStart = missingDays[0];
            const missingEnd = missingDays.at(-1);

            if (!(missingStart && missingEnd)) {
              return requestedDays
                .map((day) => allDays.get(day))
                .filter((payload): payload is WhoopCachedDayRaw =>
                  Boolean(payload)
                )
                .map(toSummary);
            }

            // Start 6 hours before midnight so WHOOP cycles/sleeps that
            // begin in the late evening (typically ~11pm when the user
            // falls asleep) are captured. Without this buffer, a sleep
            // starting at 11:54pm falls outside the next day's midnight
            // boundary and is excluded from narrow refetches.
            const fetchStart = Temporal.PlainDate.from(missingStart)
              .toZonedDateTime({
                timeZone: params.timeZone,
                plainTime: Temporal.PlainTime.from("00:00"),
              })
              .subtract({ hours: 6 })
              .toInstant()
              .toString();
            const fetchEnd = Temporal.PlainDate.from(missingEnd)
              .toZonedDateTime({
                timeZone: params.timeZone,
                plainTime: Temporal.PlainTime.from("00:00"),
              })
              .add({ days: 1 })
              .toInstant()
              .toString();

            const fetchParams = {
              start: fetchStart,
              end: fetchEnd,
            };

            const [cycles, recoveries, sleeps, workouts] = yield* Effect.all(
              [
                client.listCycles(fetchParams),
                client.listRecoveries(fetchParams),
                client.listSleeps(fetchParams),
                client.listWorkouts(fetchParams),
              ],
              { concurrency: "unbounded" }
            );

            const groupedDays = groupRawDataByDay({
              cycles,
              recoveries,
              sleeps,
              workouts,
            });

            // Only populate days that were actually missing from cache.
            // Without this guard, a cycle fetched for a missing day can
            // get grouped to an adjacent CACHED day (e.g., the active cycle
            // starts on day N but its sleep ends on day N+1), overwriting
            // that day's complete cached data with an incomplete grouping.
            const missingDaySet = new Set(missingDays);
            for (const [day, payload] of groupedDays) {
              if (!missingDaySet.has(day)) {
                continue;
              }

              allDays.set(day, payload);
              yield* cache
                .setCachedDay(
                  params.accountId,
                  day,
                  payload,
                  ttlForDay(day, params.timeZone)
                )
                .pipe(logAndSwallowWhoopCacheError);
            }
          }

          return requestedDays
            .map((day) => allDays.get(day))
            .filter((payload): payload is WhoopCachedDayRaw => Boolean(payload))
            .map(toSummary);
        }
      );

      const getProfile = Effect.fn("WhoopService.getProfile")(
        function* (params: { accountId: string; userId: string }) {
          yield* Effect.annotateCurrentSpan("accountId", params.accountId);
          yield* Effect.annotateCurrentSpan("userId", params.userId);

          const accessToken = yield* checkWhoopAccountIsLinked(
            params.userId,
            params.accountId
          );

          const client = createWhoopClient(accessToken);
          const profile = yield* client.getProfileBasic();

          return {
            firstName: profile.first_name,
            lastName: profile.last_name,
            email: profile.email,
          } satisfies WhoopProfile;
        }
      );

      return {
        getProfile,
        listDaySummaries,
      };
    }),
  }
) {}
