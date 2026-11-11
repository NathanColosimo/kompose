/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { Temporal } from "temporal-polyfill";
import {
  buildGoogleMoveUpdate,
  buildGoogleResizeUpdate,
  buildTaskMoveUpdate,
  buildTaskResizeUpdate,
} from "./drop-handlers";

const zoned = (iso: string) => Temporal.ZonedDateTime.from(iso);

describe("buildGoogleMoveUpdate", () => {
  test("preserves duration and writes the event's time zone", () => {
    const occurrence: GoogleEvent = {
      end: {
        dateTime: "2026-11-10T20:30:00-05:00",
        timeZone: "America/New_York",
      },
      id: "sync_20261110T000000Z",
      originalStartTime: {
        dateTime: "2026-11-10T09:00:00+09:00",
        timeZone: "Asia/Tokyo",
      },
      recurringEventId: "sync",
      start: {
        dateTime: "2026-11-10T19:30:00-05:00",
        timeZone: "America/New_York",
      },
    };
    const start = zoned("2026-11-10T19:30:00-05:00[America/New_York]");
    const update = buildGoogleMoveUpdate(
      {
        accountId: "acct",
        calendarId: "cal",
        end: start.add({ hours: 1 }),
        event: occurrence,
        start,
        type: "google-event",
      },
      start.add({ days: 1 })
    );
    expect(update?.event.end.dateTime).toBe("2026-11-11T20:30:00-05:00");
    expect(update?.event.start.timeZone).toBe("America/New_York");
    expect(update?.event.start.dateTime).toBe("2026-11-11T19:30:00-05:00");
  });
});

describe("drops back where they started", () => {
  const start = zoned("2026-11-10T09:00:00-05:00[America/New_York]");
  const event = {
    accountId: "acct",
    calendarId: "cal",
    end: start.add({ hours: 1 }),
    event: {
      end: { dateTime: "2026-11-10T10:00:00-05:00" },
      id: "sync_20261110T140000Z",
      recurringEventId: "sync",
      start: { dateTime: "2026-11-10T09:00:00-05:00" },
    },
    start,
  };
  const task = {
    durationMinutes: 60,
    id: "task",
    startDate: start.toPlainDate(),
    startTime: start.toPlainTime(),
  } as TaskSelectDecoded;

  test("change nothing, so they build no update", () => {
    expect(
      buildGoogleMoveUpdate({ ...event, type: "google-event" }, start)
    ).toBeNull();
    expect(
      buildGoogleResizeUpdate({
        data: { ...event, direction: "end", type: "google-event-resize" },
        targetDateTime: event.end,
      })
    ).toBeNull();
    expect(buildTaskMoveUpdate(task, start)).toBeNull();
    expect(
      buildTaskResizeUpdate({
        direction: "start",
        targetDateTime: start,
        task,
        timeZone: "America/New_York",
      })
    ).toBeNull();
  });

  test("a drop 15 minutes later still updates", () => {
    const later = start.add({ minutes: 15 });
    expect(
      buildGoogleMoveUpdate({ ...event, type: "google-event" }, later)
    ).not.toBeNull();
    expect(buildTaskMoveUpdate(task, later)).not.toBeNull();
  });
});
