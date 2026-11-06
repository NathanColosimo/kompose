import { describe, expect, test } from "bun:test";
import {
  type RecurrenceDraft,
  resolveEventRecurrence,
} from "./event-recurrence-draft";

const event = { recurringEventId: "series" };
const weekly = ["RRULE:FREQ=WEEKLY;BYDAY=MO"];
const inherited: RecurrenceDraft = { kind: "inherit" };
const overrides: { name: string; rules: string[] }[] = [
  { name: "an explicit clear", rules: [] },
  { name: "a changed rule", rules: ["RRULE:FREQ=MONTHLY"] },
];

describe("event recurrence draft", () => {
  test("a cold instance inherits the master when it arrives without resetting the draft", () => {
    expect(
      resolveEventRecurrence({
        draft: inherited,
        event,
        master: { isError: false },
      })
    ).toEqual({ kind: "loading" });
    expect(
      resolveEventRecurrence({
        draft: inherited,
        event,
        master: { data: { recurrence: weekly }, isError: false },
      })
    ).toEqual({ kind: "ready", rules: weekly });
  });

  test.each(overrides)("$name survives master refreshes", ({ rules }) => {
    for (const recurrence of [weekly, ["RRULE:FREQ=DAILY"]]) {
      expect(
        resolveEventRecurrence({
          draft: { kind: "override", rules },
          event,
          master: { data: { recurrence }, isError: false },
        })
      ).toEqual({ kind: "ready", rules });
    }
  });

  test("master errors block edits even with cached rules or an override", () => {
    for (const draft of [
      inherited,
      { kind: "override", rules: [] },
    ] satisfies RecurrenceDraft[]) {
      expect(
        resolveEventRecurrence({
          draft,
          event,
          master: { data: { recurrence: weekly }, isError: true },
        })
      ).toEqual({ kind: "error" });
    }
  });

  test("a master and a new event do not wait for an instance master query", () => {
    expect(
      resolveEventRecurrence({
        draft: inherited,
        event: { recurrence: weekly },
        master: { isError: false },
      })
    ).toEqual({ kind: "ready", rules: weekly });
    expect(
      resolveEventRecurrence({ draft: inherited, master: { isError: false } })
    ).toEqual({ kind: "ready", rules: [] });
  });
});
