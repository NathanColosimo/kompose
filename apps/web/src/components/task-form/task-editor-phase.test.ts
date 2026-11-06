import { expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import type { TaskFormValues } from "./task-edit-popover";
import { taskEditorPhaseReducer } from "./task-editor-phase";

const values: TaskFormValues = {
  description: "",
  dueDate: null,
  durationMinutes: 30,
  links: [],
  recurrence: null,
  startDate: Temporal.PlainDate.from("2026-11-06"),
  startTime: null,
  tagIds: [],
  title: "Submitted task",
};

test("scope selection keeps its snapshot and selected scope on repeated save or delete", () => {
  const prompted = taskEditorPhaseReducer(
    { type: "editing" },
    {
      scope: "this",
      type: "scope",
      values,
    }
  );
  const selected = taskEditorPhaseReducer(prompted, {
    scope: "following",
    type: "select-scope",
  });
  expect(
    taskEditorPhaseReducer(selected, {
      scope: "this",
      type: "scope",
      values: { ...values, title: "Later edits" },
    })
  ).toBe(selected);
  expect(taskEditorPhaseReducer(selected, { type: "delete" })).toBe(selected);
  expect(selected).toEqual({ scope: "following", type: "scope", values });
});

test("delete confirmation blocks scope selection until cancelled", () => {
  const deleting = taskEditorPhaseReducer(
    { type: "editing" },
    { type: "delete" }
  );
  expect(
    taskEditorPhaseReducer(deleting, { scope: "this", type: "scope", values })
  ).toBe(deleting);
  const editing = taskEditorPhaseReducer(deleting, { type: "editing" });
  expect(
    taskEditorPhaseReducer(editing, { scope: "this", type: "scope", values })
  ).toEqual({
    scope: "this",
    type: "scope",
    values,
  });
});
