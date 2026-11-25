import { Database } from "@kompose/db";
import {
  type Activity,
  activitySelectSchema,
  activityTable,
} from "@kompose/db/schema/activity";
import { account } from "@kompose/db/schema/auth";
import { connectionTable } from "@kompose/db/schema/connection";
import {
  type DayMetric,
  dayMetrics,
  dayMetricTable,
} from "@kompose/db/schema/day-metric";
import type { PluginId, PluginProvider } from "@kompose/plugins";
import { createWhoopClient } from "@kompose/whoop/client";
import type {
  WhoopCycle,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
} from "@kompose/whoop/schema";
import {
  and,
  between,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import z from "zod";
import {
  getLinkedAccessToken,
  type LinkedAccount,
  LinkedAccountError,
} from "../../lib/linked-account";
import { publishToUser } from "../../realtime/sync";
import type { WhoopDaySummary } from "./contract";
import { WhoopInvalidRangeError } from "./errors";

const MAX_RANGE_DAYS = 62;
const WHOOP_PLUGIN = "whoop" satisfies PluginId;
const WHOOP_PROVIDER = "whoop" satisfies PluginProvider;
/** How many days of history a connection's first sync stores. */
const BACKFILL_DAYS = 90;
/** The least time between two fetches of a connection's recent days. */
const RECENT_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const KILOCALORIES_PER_KILOJOULE = 0.239_006;

/** One WHOOP webhook: a record of a WHOOP user was updated or deleted. */
export interface WhoopChange {
  /** The workout's or sleep's ID. A recovery event carries its sleep's ID. */
  id: string;
  /** `workout.updated`, `sleep.deleted`, `recovery.updated`, and so on. */
  type: string;
  whoopUserId: string;
}

/** A WHOOP connection, with the account a sync fetches as. */
interface WhoopConnection {
  id: string;
  link: LinkedAccount;
  /** The earliest day stored; null before the first sync. */
  syncedFrom: string | null;
}

/** One day's WHOOP records, as `groupRawDataByDay` assigns them. */
interface WhoopDay {
  cycle: WhoopCycle | null;
  day: string;
  recovery: WhoopRecovery | null;
  sleeps: WhoopSleep[];
  workouts: WhoopWorkout[];
}

/**
 * The client call that reads the record an event names. A deleted record
 * can't be read, and a recovery event carries its sleep's ID.
 */
function recordLookup(type: string) {
  switch (type) {
    case "workout.updated":
      return "getWorkout";
    case "sleep.updated":
    case "recovery.updated":
      return "getSleep";
    default:
      return;
  }
}

function dateFromOffset(dateTime: string, offset: string): string {
  return Temporal.Instant.from(dateTime)
    .toZonedDateTimeISO(offset)
    .toPlainDate()
    .toString();
}

function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

function inclusiveDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  for (let day = startDate; day <= endDate; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

const validateRange = Effect.fn("WhoopService.validateRange")(function* (
  startDate: string,
  endDate: string
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
});

function selectPrimarySleep(payload: WhoopDay): WhoopSleep | null {
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

/** Time asleep, from WHOOP's sleep stages; null until WHOOP scores them. */
function asleepMinutes(sleep: WhoopSleep): number | null {
  const stages = sleep.score?.stage_summary;
  const asleep =
    (stages?.total_light_sleep_time_milli ?? 0) +
    (stages?.total_slow_wave_sleep_time_milli ?? 0) +
    (stages?.total_rem_sleep_time_milli ?? 0);
  return asleep > 0 ? Math.round(asleep / 60_000) : null;
}

/** A WHOOP day as the rows Kompose stores. See documents/whoop.md. */
function toRows(connectionId: string, day: WhoopDay) {
  const primarySleep = selectPrimarySleep(day);
  const kilojoule = day.cycle?.score?.kilojoule;
  const values: Record<DayMetric, number | null | undefined> = {
    energy_burned_kcal:
      kilojoule == null ? null : kilojoule * KILOCALORIES_PER_KILOJOULE,
    recovery_score: day.recovery?.score?.recovery_score,
    sleep_duration_min: primarySleep && asleepMinutes(primarySleep),
    sleep_performance: primarySleep?.score?.sleep_performance_percentage,
    strain: day.cycle?.score?.strain,
  };
  const shared = { connectionId, date: day.day };

  return {
    activities: [
      ...day.sleeps.map((sleep) => ({
        ...shared,
        details: { asleepMinutes: asleepMinutes(sleep), nap: sleep.nap },
        endAt: new Date(sleep.end),
        externalId: sleep.id,
        id: uuidv7(),
        kind: "sleep" as const,
        startAt: new Date(sleep.start),
        title: null,
      })),
      ...day.workouts.map((workout) => ({
        ...shared,
        details: { strain: workout.score?.strain ?? null },
        endAt: new Date(workout.end),
        externalId: workout.id,
        id: uuidv7(),
        kind: "workout" as const,
        startAt: new Date(workout.start),
        title: workout.sport_name || null,
      })),
    ],
    metrics: dayMetrics.flatMap((metric) => {
      const value = values[metric];
      return value == null ? [] : [{ ...shared, metric, value }];
    }),
  };
}

/** Stored rows as the day summaries `whoop.days.list` has always returned. */
function toSummaries(
  metrics: (typeof dayMetricTable.$inferSelect)[],
  activities: Activity[]
): WhoopDaySummary[] {
  const values = new Map(
    metrics.map(({ date, metric, value }) => [`${date} ${metric}`, value])
  );
  const sleepSummary = (sleep: Activity & { kind: "sleep" }) => ({
    end: sleep.endAt.toISOString(),
    id: sleep.externalId,
    start: sleep.startAt.toISOString(),
    totalSleepMilliseconds:
      sleep.details.asleepMinutes === null
        ? sleep.endAt.getTime() - sleep.startAt.getTime()
        : sleep.details.asleepMinutes * 60_000,
  });
  const days = new Set([
    ...metrics.map(({ date }) => date),
    ...activities.map(({ date }) => date),
  ]);
  const allSleeps = activities.filter((activity) => activity.kind === "sleep");
  const allWorkouts = activities.filter(
    (activity) => activity.kind === "workout"
  );

  return [...days].sort().map((day) => {
    const value = (metric: DayMetric) => values.get(`${day} ${metric}`) ?? null;
    const sleeps = allSleeps.filter((sleep) => sleep.date === day);
    const [longestNight] = sleeps
      .filter((sleep) => !sleep.details.nap)
      .sort(
        (left, right) =>
          right.endAt.getTime() -
          right.startAt.getTime() -
          (left.endAt.getTime() - left.startAt.getTime())
      );
    const energy = value("energy_burned_kcal");

    return {
      day,
      kilojoule: energy === null ? null : energy / KILOCALORIES_PER_KILOJOULE,
      naps: sleeps.filter((sleep) => sleep.details.nap).map(sleepSummary),
      recoveryScore: value("recovery_score"),
      sleep: longestNight ? sleepSummary(longestNight) : null,
      sleepPerformance: value("sleep_performance"),
      strainScore: value("strain"),
      workouts: allWorkouts
        .filter((workout) => workout.date === day)
        .map((workout) => ({
          end: workout.endAt.toISOString(),
          id: workout.externalId,
          sportName: workout.title,
          start: workout.startAt.toISOString(),
          strainScore: workout.details.strain,
        })),
    };
  });
}

function initializeDay(day: string): WhoopDay {
  return {
    cycle: null,
    day,
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
}): Map<string, WhoopDay> {
  const byDay = new Map<string, WhoopDay>();

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
    // A stored record has one day, so the first cycle to claim a workout
    // keeps it.
    const cycleWorkouts = params.workouts.filter(
      (w) => !assignedWorkoutIds.has(w.id) && workoutBelongsToCycle(w, cycle)
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
    make: Effect.sync(() => {
      const findConnections = Effect.fn("WhoopService.findConnections")(
        function* (where: SQL | undefined) {
          const db = yield* Database;
          const rows = yield* db
            .select({
              accountRowId: account.id,
              id: connectionTable.id,
              syncedFrom: connectionTable.syncedFrom,
              userId: account.userId,
              whoopUserId: account.accountId,
            })
            .from(connectionTable)
            .innerJoin(account, eq(connectionTable.accountId, account.id))
            .where(and(eq(connectionTable.pluginId, WHOOP_PLUGIN), where))
            .pipe(Effect.orDie);
          return rows.map(
            ({
              accountRowId,
              id,
              syncedFrom,
              userId,
              whoopUserId,
            }): WhoopConnection => ({
              id,
              link: {
                accountId: whoopUserId,
                id: accountRowId,
                providerId: WHOOP_PROVIDER,
                userId,
              },
              syncedFrom,
            })
          );
        }
      );

      /**
       * Fetches a connection's days from WHOOP and stores them in place of
       * what was stored for those days, so a record WHOOP no longer has goes.
       */
      const sync = Effect.fn("WhoopService.sync")(function* (
        connection: WhoopConnection,
        startDate: string,
        endDate: string
      ) {
        yield* Effect.annotateCurrentSpan("connectionId", connection.id);
        yield* Effect.annotateCurrentSpan("startDate", startDate);
        yield* Effect.annotateCurrentSpan("endDate", endDate);

        const client = createWhoopClient(
          yield* getLinkedAccessToken(connection.link)
        );
        // A day's records start up to a day before it in UTC (its cycle
        // begins the evening before, and the user can be east of UTC) and
        // up to a day after it ends. Days at the edges of the window come
        // back incomplete, so only the days asked for are stored.
        const fetchParams = {
          end: `${addDays(endDate, 2)}T00:00:00Z`,
          start: `${addDays(startDate, -1)}T00:00:00Z`,
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
        const grouped = groupRawDataByDay({
          cycles,
          recoveries,
          sleeps,
          workouts,
        });
        const rows = inclusiveDays(startDate, endDate).map((day) =>
          toRows(connection.id, grouped.get(day) ?? initializeDay(day))
        );
        const metrics = rows.flatMap((day) => day.metrics);
        const activities = rows.flatMap((day) => day.activities);

        const db = yield* Database;
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(dayMetricTable)
                .where(
                  and(
                    eq(dayMetricTable.connectionId, connection.id),
                    between(dayMetricTable.date, startDate, endDate)
                  )
                );
              yield* tx.delete(activityTable).where(
                and(
                  eq(activityTable.connectionId, connection.id),
                  between(activityTable.date, startDate, endDate),
                  notInArray(
                    activityTable.externalId,
                    activities.map(({ externalId }) => externalId)
                  )
                )
              );
              // WHOOP sends a sleep's and its recovery's webhooks together,
              // so two syncs of the same days run at once: both writes are
              // upserts.
              if (metrics.length > 0) {
                yield* tx
                  .insert(dayMetricTable)
                  .values(metrics)
                  .onConflictDoUpdate({
                    set: { value: sql`excluded.value` },
                    target: [
                      dayMetricTable.connectionId,
                      dayMetricTable.date,
                      dayMetricTable.metric,
                    ],
                  });
              }
              if (activities.length > 0) {
                yield* tx
                  .insert(activityTable)
                  .values(activities)
                  .onConflictDoUpdate({
                    set: {
                      date: sql`excluded.date`,
                      details: sql`excluded.details`,
                      endAt: sql`excluded.end_at`,
                      startAt: sql`excluded.start_at`,
                      title: sql`excluded.title`,
                    },
                    target: [
                      activityTable.connectionId,
                      activityTable.externalId,
                    ],
                  });
              }
            })
          )
          .pipe(Effect.orDie);
      });

      /**
       * Stores the days of a read that a connection has never synced.
       *
       * A connection's first read stores the last 90 days. After that, a
       * read that starts before `syncedFrom` fetches its own days, and never
       * the whole gap up to `syncedFrom`: a jump years back would otherwise
       * fetch years of records in one request. `syncedFrom` moves back only
       * when the read's days reach it, so days that were jumped to are
       * fetched on each read until the history reaches them.
       */
      const syncMissingDays = Effect.fn("WhoopService.syncMissingDays")(
        function* (
          connection: WhoopConnection,
          startDate: string,
          endDate: string
        ) {
          const db = yield* Database;
          const setSyncedFrom = (syncedFrom: string) =>
            db
              .update(connectionTable)
              .set({ syncedFrom })
              .where(eq(connectionTable.id, connection.id))
              .pipe(Effect.orDie);

          let { syncedFrom } = connection;
          if (syncedFrom === null) {
            const today = Temporal.Now.plainDateISO("UTC").toString();
            syncedFrom = addDays(today, -BACKFILL_DAYS);
            // Tomorrow in UTC, because east of UTC it can already be today.
            yield* sync(connection, syncedFrom, addDays(today, 1));
            yield* setSyncedFrom(syncedFrom);
          }
          if (startDate >= syncedFrom) {
            return;
          }
          const reachesHistory = endDate >= addDays(syncedFrom, -1);
          yield* sync(
            connection,
            startDate,
            reachesHistory ? syncedFrom : endDate
          );
          if (reachesHistory) {
            yield* setSyncedFrom(startDate);
          }
        }
      );

      const listDaySummaries = Effect.fn("WhoopService.listDaySummaries")(
        function* (params: {
          accountId: string;
          endDate: string;
          startDate: string;
          userId: string;
        }) {
          yield* Effect.annotateCurrentSpan("accountId", params.accountId);
          yield* Effect.annotateCurrentSpan("userId", params.userId);
          yield* Effect.annotateCurrentSpan("startDate", params.startDate);
          yield* Effect.annotateCurrentSpan("endDate", params.endDate);

          yield* validateRange(params.startDate, params.endDate);

          const [connection] = yield* findConnections(
            and(
              eq(account.accountId, params.accountId),
              eq(account.userId, params.userId)
            )
          );
          if (!connection) {
            return yield* new LinkedAccountError({
              accountId: params.accountId,
              cause: new Error("No WHOOP connection for the account"),
              providerId: WHOOP_PROVIDER,
            });
          }
          yield* syncMissingDays(connection, params.startDate, params.endDate);

          const db = yield* Database;
          const [metrics, activities] = yield* Effect.all(
            [
              db
                .select()
                .from(dayMetricTable)
                .where(
                  and(
                    eq(dayMetricTable.connectionId, connection.id),
                    between(
                      dayMetricTable.date,
                      params.startDate,
                      params.endDate
                    )
                  )
                ),
              db
                .select()
                .from(activityTable)
                .where(
                  and(
                    eq(activityTable.connectionId, connection.id),
                    between(
                      activityTable.date,
                      params.startDate,
                      params.endDate
                    )
                  )
                )
                .orderBy(activityTable.startAt),
            ],
            { concurrency: "unbounded" }
          ).pipe(Effect.orDie);

          return toSummaries(
            metrics,
            z.array(activitySelectSchema).parse(activities)
          );
        }
      );

      /**
       * Fetches a user's last few WHOOP days again, when one of their clients
       * connects, and tells the clients to refetch. WHOOP sends no webhook
       * for a day's strain and energy, and may skip one for anything else.
       * A connection is fetched at most once in 10 minutes, because WHOOP
       * limits the requests an app makes in a day.
       */
      const syncRecent = Effect.fn("WhoopService.syncRecent")(function* (
        userId: string
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        const db = yield* Database;
        // Claim the sync first, so clients that connect together fetch once.
        const claimed = yield* db
          .update(connectionTable)
          .set({ syncedAt: new Date().toISOString() })
          .where(
            and(
              eq(connectionTable.userId, userId),
              eq(connectionTable.pluginId, WHOOP_PLUGIN),
              eq(connectionTable.status, "active"),
              // The first read stores a connection's history.
              isNotNull(connectionTable.syncedFrom),
              or(
                isNull(connectionTable.syncedAt),
                lt(
                  connectionTable.syncedAt,
                  new Date(Date.now() - RECENT_SYNC_INTERVAL_MS).toISOString()
                )
              )
            )
          )
          .returning({ id: connectionTable.id })
          .pipe(Effect.orDie);
        if (claimed.length === 0) {
          return;
        }

        const connections = yield* findConnections(
          inArray(
            connectionTable.id,
            claimed.map(({ id }) => id)
          )
        );
        const today = Temporal.Now.plainDateISO("UTC").toString();
        yield* Effect.forEach(
          connections,
          (connection) =>
            sync(connection, addDays(today, -2), addDays(today, 1)),
          { discard: true }
        );
        yield* publishToUser(userId, { payload: {}, type: "whoop" });
      });

      /**
       * The days a changed record can be on, or `undefined` when that can't
       * be known. WHOOP names the record, not its day.
       *
       * An updated record is read from WHOOP. It lands on its cycle's
       * wake-up day (see `groupRawDataByDay`), which is the day it starts or
       * the day before, and a new sleep also closes the cycle before it, so
       * its days run from the day before it starts to the day it ends.
       *
       * A deleted record can't be read, and a read can fail. Then the days
       * come from the stored row, if the record was stored.
       */
      const changedDays = Effect.fn("WhoopService.changedDays")(function* (
        connection: WhoopConnection,
        change: WhoopChange
      ) {
        const lookup = recordLookup(change.type);
        if (lookup) {
          const record = yield* Effect.gen(function* () {
            const client = createWhoopClient(
              yield* getLinkedAccessToken(connection.link)
            );
            return yield* client[lookup](change.id);
          }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("WHOOP_CHANGED_RECORD_LOOKUP_FAILED", {
                error,
              }).pipe(Effect.as(undefined))
            )
          );
          if (record) {
            return {
              end: dateFromOffset(record.end, record.timezone_offset),
              start: addDays(
                dateFromOffset(record.start, record.timezone_offset),
                -1
              ),
            };
          }
        }

        const db = yield* Database;
        const [stored] = yield* db
          .select({ date: activityTable.date })
          .from(activityTable)
          .where(
            and(
              eq(activityTable.connectionId, connection.id),
              eq(activityTable.externalId, change.id)
            )
          )
          .pipe(Effect.orDie);
        return stored && { end: stored.date, start: addDays(stored.date, -1) };
      });

      /**
       * WHOOP says a record of a user changed (a webhook). Fetches the days
       * it can be on again, for the connection of that WHOOP user, and tells
       * its owner's open clients to refetch. A WHOOP user nobody has linked,
       * or a record whose days aren't known, changes nothing.
       */
      const dataChanged = Effect.fn("WhoopService.dataChanged")(function* (
        change: WhoopChange
      ) {
        yield* Effect.annotateCurrentSpan("whoopUserId", change.whoopUserId);
        yield* Effect.annotateCurrentSpan("type", change.type);
        const connections = yield* findConnections(
          eq(account.accountId, change.whoopUserId)
        );
        yield* Effect.forEach(
          connections,
          Effect.fnUntraced(function* (connection) {
            const days = yield* changedDays(connection, change);
            if (!days) {
              return;
            }
            yield* sync(connection, days.start, days.end);
            yield* publishToUser(connection.link.userId, {
              payload: {},
              type: "whoop",
            });
          }),
          { discard: true }
        );
      });

      return { dataChanged, listDaySummaries, syncRecent };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
