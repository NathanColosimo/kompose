import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { resolveWhen } from "@/lib/resolve-when";

// Friday, Oct 23 2026, 10:00 in New York.
const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe("resolveWhen", () => {
  test.each([
    // [phrase, date, time or null]
    ["tomorrow", "2026-10-24", null],
    ["tmr", "2026-10-24", null],
    ["tomorrow at 4am", "2026-10-24", "04:00:00"],
    ["next tue 3pm", "2026-10-27", "15:00:00"],
    ["noon tmrw", "2026-10-24", "12:00:00"],
    ["in 45 minutes", "2026-10-23", "10:45:00"],
    ["end of month", "2026-10-31", null],
    ["nov 1", "2026-11-01", null],
    ["the 15th", "2026-11-15", null],
    ["on the 1st", "2026-11-01", null],
    ["weds", "2026-10-28", null],
    ["first monday of next month", "2026-11-02", null],
    ["3pm-5pm thursday", "2026-10-29", "15:00:00"],
  ])("%p", async (phrase, date, time) => {
    const when = await resolveWhen(phrase, { now });
    expect(when?.date.toString()).toBe(date);
    expect(when?.time?.toString() ?? null).toBe(time);
  });

  test.each([
    ["tomorrow at 4", "2026-10-24"],
    ["in 2 days at 4", "2026-10-25"],
  ])("reads a bare low hour in %p as the afternoon", async (phrase, date) => {
    const when = await resolveWhen(phrase, { now });
    expect(when?.date.toString()).toBe(date);
    expect(when?.time?.toString()).toBe("16:00:00");
  });

  test("starts a day part at a plausible time", async () => {
    const when = await resolveWhen("sat morning", { now });
    expect(when?.time?.toString()).toBe("09:00:00");
  });

  test("resolves a recurrence to its next date", async () => {
    const when = await resolveWhen("every weekday at 9:30", { now });
    expect(when?.date.toString()).toBe("2026-10-26");
    expect(when?.time?.toString()).toBe("09:30:00");
  });

  test("returns null without a date", async () => {
    expect(await resolveWhen("groceries", { now })).toBeNull();
    expect(await resolveWhen("  ", { now })).toBeNull();
  });
});
