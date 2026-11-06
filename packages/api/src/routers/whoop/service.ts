import { createWhoopClient } from "@kompose/whoop/client";
import type {
  WhoopCachedDayRaw,
  WhoopCycle,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
} from "@kompose/whoop/schema";
import { Context, Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { getLinkedAccessToken } from "../../lib/linked-account";
import { WhoopCacheService } from "./cache";
import type { WhoopDaySummary, WhoopProfile } from "./contract";
import { whoopDaySummarySchema } from "./contract";
import { missingDayFetchRanges, ttlForDay } from "./day-policy";
import { WhoopInvalidRangeError } from "./errors";

const MAX_RANGE_DAYS = 62;

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
    cycleId: payload.cycle?.id ?? null,
    day: payload.day,
    kilojoule: payload.cycle?.score?.kilojoule ?? null,
    naps: payload.sleeps
      .filter((sleep) => sleep.nap)
      .map((nap) => ({
        end: nap.end,
        id: nap.id,
        start: nap.start,
        totalSleepMilliseconds: totalSleepMilliseconds(nap),
      })),
    recoveryScore: payload.recovery?.score?.recovery_score ?? null,
    sleep: primarySleep
      ? {
          end: primarySleep.end,
          id: primarySleep.id,
          start: primarySleep.start,
          totalSleepMilliseconds: totalSleepMilliseconds(primarySleep),
        }
      : null,
    sleepPerformance: primarySleep?.score?.sleep_performance_percentage ?? null,
    strainScore: payload.cycle?.score?.strain ?? null,
    workouts: [...payload.workouts]
      .sort((left, right) => left.start.localeCompare(right.start))
      .map((workout) => ({
        end: workout.end,
        id: workout.id,
        sportId: workout.sport_id ?? null,
        sportName: workout.sport_name || null,
        start: workout.start,
        strainScore: workout.score?.strain ?? null,
      })),
  });
}

function initializeDay(day: string): WhoopCachedDayRaw {
  return {
    cycle: null,
    day,
    recovery: null,
    sleeps: [],
    workouts: [],
  };
}

function hasData(
  payload: WhoopCachedDayRaw | undefined
): payload is WhoopCachedDayRaw {
  if (!payload) {
    return false;
  }

  return (
    payload.cycle !== null ||
    payload.recovery !== null ||
    payload.sleeps.length > 0 ||
    payload.workouts.length > 0
  );
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

export class WhoopService extends Context.Service<WhoopService>()(
  "WhoopService",
  {
    make: Effect.gen(function* () {
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

          const now = Temporal.Now.instant();
          const today = now
            .toZonedDateTimeISO(params.timeZone)
            .toPlainDate()
            .toString();
          // Future days are empty by definition, including any old cache entries.
          const requestedDays = inclusiveDays(
            params.startDate,
            params.endDate
          ).filter((day) => day <= today);
          const cachedDays = yield* cache.getCachedDays(
            params.userId,
            params.accountId,
            requestedDays
          );

          const fetchRanges = missingDayFetchRanges({
            cachedDays,
            days: requestedDays,
            timeZone: params.timeZone,
            today,
          });
          const allDays = new Map(cachedDays);

          if (fetchRanges.length > 0) {
            // Only fetch a token on a cache miss; user-scoped cache keys
            // already keep one user from reading another's cached days.
            const accessToken = yield* getLinkedAccessToken({
              accountId: params.accountId,
              providerId: "whoop",
              userId: params.userId,
            });
            const client = createWhoopClient(accessToken);

            for (const range of fetchRanges) {
              const fetchParams = { end: range.end, start: range.start };

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

              // Only write days that were actually missing from cache. A cycle
              // fetched for a missing day can get grouped to an adjacent CACHED
              // day (e.g., the active cycle starts on day N but its sleep ends
              // on day N+1), which would overwrite that day's complete cached
              // data with an incomplete grouping.
              const fetchedDays = range.days.map(
                (day) => groupedDays.get(day) ?? initializeDay(day)
              );
              for (const payload of fetchedDays) {
                allDays.set(payload.day, payload);
              }
              yield* Effect.forEach(
                fetchedDays,
                (payload) =>
                  cache.setCachedDay(
                    params.userId,
                    params.accountId,
                    payload.day,
                    payload,
                    ttlForDay(payload, params.timeZone, now)
                  ),
                { concurrency: "unbounded", discard: true }
              );
            }
          }

          return requestedDays
            .map((day) => allDays.get(day))
            .filter(hasData)
            .map(toSummary);
        }
      );

      const getProfile = Effect.fn("WhoopService.getProfile")(
        function* (params: { accountId: string; userId: string }) {
          yield* Effect.annotateCurrentSpan("accountId", params.accountId);
          yield* Effect.annotateCurrentSpan("userId", params.userId);

          const accessToken = yield* getLinkedAccessToken({
            providerId: "whoop",
            accountId: params.accountId,
            userId: params.userId,
          });

          const client = createWhoopClient(accessToken);
          const profile = yield* client.getProfileBasic();

          return {
            email: profile.email,
            firstName: profile.first_name,
            lastName: profile.last_name,
          } satisfies WhoopProfile;
        }
      );

      return {
        getProfile,
        listDaySummaries,
      };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(WhoopCacheService.layer)
  );
}
