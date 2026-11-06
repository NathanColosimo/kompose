import { expect, test } from "bun:test";
import type { TaskRecurrence } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import {
  buildTaskRecurrence,
  getTaskRecurrenceEditorState,
  type TaskRecurrenceEditorState,
} from "./task-recurrence";

test("applying an until end to an endless recurrence always serializes its date", () => {
  const referenceDate = Temporal.PlainDate.from("2026-11-06");
  const state = getTaskRecurrenceEditorState(null, referenceDate);

  expect(
    buildTaskRecurrence({
      ...state,
      end: { date: referenceDate, kind: "until" },
    })
  ).toEqual({
    byDay: ["FR"],
    freq: "WEEKLY",
    interval: 1,
    until: "2026-11-06",
  });
});

test.each<TaskRecurrence>([
  { freq: "DAILY", interval: 2, until: "2026-12-01" },
  { byDay: ["MO", "FR"], count: 7, freq: "WEEKLY", interval: 1 },
  { byMonthDay: 15, freq: "MONTHLY", interval: 1, until: "2027-01-15" },
  { count: 3, freq: "YEARLY", interval: 1 },
  { freq: "DAILY", interval: 1 },
])("editing a recurrence preserves its end limit: %j", (recurrence) => {
  expect(buildTaskRecurrence(getTaskRecurrenceEditorState(recurrence))).toEqual(
    recurrence
  );
});

test("switching end modes removes the previous limit", () => {
  const state = getTaskRecurrenceEditorState({
    count: 7,
    freq: "DAILY",
    interval: 1,
  });
  const untilState: TaskRecurrenceEditorState = {
    ...state,
    end: {
      date: Temporal.PlainDate.from("2026-12-01"),
      kind: "until",
    },
  };

  expect(buildTaskRecurrence(untilState)).toEqual({
    freq: "DAILY",
    interval: 1,
    until: "2026-12-01",
  });
  expect(
    buildTaskRecurrence({ ...untilState, end: { kind: "never" } })
  ).toEqual({
    freq: "DAILY",
    interval: 1,
  });
  expect(
    buildTaskRecurrence({ ...untilState, end: { count: 4, kind: "count" } })
  ).toEqual({ count: 4, freq: "DAILY", interval: 1 });
});
