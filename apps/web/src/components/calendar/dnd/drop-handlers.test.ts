/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { Temporal } from "temporal-polyfill";
import { buildGoogleMoveUpdate } from "./drop-handlers";

const zoned = (iso: string) => Temporal.ZonedDateTime.from(iso);

describe("buildGoogleMoveUpdate", () => {
  test("writes an occurrence in its series' zone, not its own", () => {
    // A Tokyo series' Tuesday 9:00 meeting, rescheduled from New York, so
    // its own start carries New York's zone; its slot is still Tokyo's.
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
    expect(update.event.start.timeZone).toBe("Asia/Tokyo");
    expect(update.event.start.dateTime).toBe("2026-11-12T09:30:00+09:00");
  });
});
