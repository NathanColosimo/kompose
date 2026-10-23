import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { checkPhrases, parseDurationText } from "@/lib/smart-task-input";

// Friday, Oct 23 2026, 10:00 in New York.
const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe("parseDurationText", () => {
  test.each([
    ["for an hour", 60],
    ["45 min", 45],
    ["1h 30m", 90],
    ["half an hour", 30],
    ["2.5 hours", 150],
    ["soon", null],
  ])("%p is %p minutes", (text, minutes) => {
    expect(parseDurationText(text)).toBe(minutes);
  });
});

describe("checkPhrases", () => {
  test("drops phrases the input doesn't contain", async () => {
    const input = "call mom";
    const phrases = await checkPhrases({
      extraction: { title: "call mom", whenText: "next tue 3pm" },
      input,
      now,
    });
    expect(phrases.when).toBeUndefined();
  });

  test("moves a deadline phrase out of the start", async () => {
    const input = "taxes before end of month";
    const phrases = await checkPhrases({
      extraction: { title: "taxes", whenText: "before end of month" },
      input,
      now,
    });
    expect(phrases).toEqual({
      deadline: "end of month",
      duration: undefined,
      when: undefined,
    });
  });

  test("drops a start that repeats the deadline", async () => {
    const input = "report due nov 1";
    const phrases = await checkPhrases({
      extraction: { deadlineText: "nov 1", title: "report", whenText: "nov 1" },
      input,
      now,
    });
    expect(phrases.when).toBeUndefined();
    expect(phrases.deadline).toBe("nov 1");
  });

  test("widens a clipped start to the whole date expression", async () => {
    const input = "dentist in 2 days at 4";
    const phrases = await checkPhrases({
      extraction: { title: "dentist", whenText: "in 2 days" },
      input,
      now,
    });
    expect(phrases.when).toBe("in 2 days at 4");
  });

  test("widens past a duration in the same sentence", async () => {
    const input = "call mom tomorrow at 4 for 30m";
    const phrases = await checkPhrases({
      extraction: {
        durationText: "for 30m",
        title: "call mom",
        whenText: "tomorrow",
      },
      input,
      now,
    });
    expect(phrases.when).toBe("tomorrow at 4");
    expect(phrases.duration).toBe("for 30m");
  });
});
