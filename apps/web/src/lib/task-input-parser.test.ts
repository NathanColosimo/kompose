import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { parseTaskInput, resolveTokenDates } from "@/lib/task-input-parser";

const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe("parseTaskInput", () => {
  test("splits the title from tokens", () => {
    const parsed = parseTaskInput(
      "Read that book =1h30m >monday ~tmrw #reading"
    );
    expect(parsed.title).toBe("Read that book");
    expect(parsed.durationMinutes).toBe(90);
    expect(parsed.dueDateRaw).toBe("monday");
    expect(parsed.startDateRaw).toBe("tmrw");
    expect(parsed.tagNames).toEqual(["reading"]);
  });
});

describe("resolveTokenDates", () => {
  test("resolves due and start tokens, with a start time", async () => {
    const dates = await resolveTokenDates(
      { dueDateRaw: "monday", startDateRaw: "thu 3pm" },
      { now }
    );
    expect(dates.dueDate?.toString()).toBe("2026-10-26");
    expect(dates.startDate?.toString()).toBe("2026-10-29");
    expect(dates.startTime?.toString()).toBe("15:00:00");
  });

  test("leaves missing tokens empty", async () => {
    expect(
      await resolveTokenDates({ dueDateRaw: null, startDateRaw: null }, { now })
    ).toEqual({ dueDate: null, startDate: null, startTime: null });
  });
});
