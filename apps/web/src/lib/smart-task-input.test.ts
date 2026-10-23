import { describe, expect, test } from "bun:test";
import {
  checkPhrases,
  parseDurationText,
  resolveWhen,
} from "@/lib/smart-task-input";

// Thursday, Oct 23 2026, 10:00 local time.
const referenceDate = new Date(2026, 9, 23, 10);

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

describe("resolveWhen", () => {
  test("keeps a date without a time", () => {
    const when = resolveWhen("tomorrow", referenceDate);
    expect(when?.date.toString()).toBe("2026-10-24");
    expect(when?.time).toBeNull();
  });

  test("reads a bare low hour as the afternoon", () => {
    expect(resolveWhen("tomorrow at 4", referenceDate)?.time?.toString()).toBe(
      "16:00:00"
    );
  });

  test("keeps an explicit morning time", () => {
    expect(
      resolveWhen("tomorrow at 4am", referenceDate)?.time?.toString()
    ).toBe("04:00:00");
  });

  test("resolves weekdays forward", () => {
    expect(resolveWhen("next tue 3pm", referenceDate)?.date.toString()).toBe(
      "2026-10-27"
    );
  });

  test("returns null without a date", () => {
    expect(resolveWhen("groceries", referenceDate)).toBeNull();
  });
});

describe("checkPhrases", () => {
  test("drops phrases the input doesn't contain", () => {
    const input = "call mom";
    const phrases = checkPhrases({
      extraction: { title: "call mom", whenText: "next tue 3pm" },
      input,
      referenceDate,
    });
    expect(phrases.when).toBeUndefined();
  });

  test("moves a deadline phrase out of the start", () => {
    const input = "taxes before end of month";
    const phrases = checkPhrases({
      extraction: { title: "taxes", whenText: "before end of month" },
      input,
      referenceDate,
    });
    expect(phrases).toEqual({
      deadline: "end of month",
      duration: undefined,
      when: undefined,
    });
  });

  test("drops a start that repeats the deadline", () => {
    const input = "report due nov 1";
    const phrases = checkPhrases({
      extraction: { deadlineText: "nov 1", title: "report", whenText: "nov 1" },
      input,
      referenceDate,
    });
    expect(phrases.when).toBeUndefined();
    expect(phrases.deadline).toBe("nov 1");
  });

  test("widens a clipped start to the whole date expression", () => {
    const input = "dentist in 2 days at 4";
    const phrases = checkPhrases({
      extraction: { title: "dentist", whenText: "in 2 days" },
      input,
      referenceDate,
    });
    expect(phrases.when).toBe("in 2 days at 4");
  });
});
