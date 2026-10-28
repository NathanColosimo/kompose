import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { parseTaskInput } from "@/lib/task-input-parser";

const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe("parseTaskInput", () => {
  test("splits the title from tokens", () => {
    const parsed = parseTaskInput(
      "Read that book =1h30m >monday ~tmrw #reading",
      now
    );
    expect(parsed.title).toBe("Read that book");
    expect(parsed.durationMinutes).toBe(90);
    expect(parsed.dueDateRaw).toBe("monday");
    expect(parsed.startDateRaw).toBe("tmrw");
    expect(parsed.tagNames).toEqual(["reading"]);
  });

  test("resolves due and start tokens, with a start time", () => {
    const parsed = parseTaskInput("Plan >monday ~thu 3pm", now);
    expect(parsed.dueDate?.toString()).toBe("2026-10-26");
    expect(parsed.startDate?.toString()).toBe("2026-10-29");
    expect(parsed.startTime?.toString()).toBe("15:00:00");
  });

  test("leaves missing tokens empty", () => {
    const parsed = parseTaskInput("Plan", now);
    expect(parsed.dueDate).toBeNull();
    expect(parsed.startDate).toBeNull();
    expect(parsed.startTime).toBeNull();
  });
});
