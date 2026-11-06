import { describe, expect, test } from "bun:test";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import {
  buildTaskDraft,
  type TaskEditorState,
  taskEditorFlowReducer,
} from "./task-editor-flow";

const task: TaskSelectDecoded = {
  createdAt: Temporal.Instant.from("2026-11-06T12:00:00Z"),
  description: null,
  dueDate: null,
  durationMinutes: 30,
  id: "task-a",
  isException: false,
  links: [],
  recurrence: { freq: "DAILY", interval: 1 },
  seriesMasterId: "task-a",
  startDate: Temporal.PlainDate.from("2026-11-06"),
  startTime: null,
  status: "todo",
  tags: [],
  title: "Original task",
  updatedAt: Temporal.Instant.from("2026-11-06T12:00:00Z"),
  userId: "user-a",
};

function edit(source = task): TaskEditorState {
  return taskEditorFlowReducer(
    { kind: "closed" },
    { sessionId: "session-a", task: source, type: "openEdit" }
  );
}

describe("task editor lifecycle", () => {
  test("opening another task discards a pending scoped save and its scope", () => {
    const draft = { ...buildTaskDraft(task), title: "Changed title" };
    const pending = taskEditorFlowReducer(edit(), { draft, type: "save" });
    expect(pending).toEqual({ draft, kind: "saveScope", scope: "this", task });
    const selected = taskEditorFlowReducer(pending, {
      scope: "following",
      type: "setScope",
    });

    const otherTask = { ...task, id: "task-b", title: "Another task" };
    expect(
      taskEditorFlowReducer(selected, {
        sessionId: "session-b",
        task: otherTask,
        type: "openEdit",
      })
    ).toEqual({ kind: "edit", sessionId: "session-b", task: otherTask });
  });

  test("closing releases all task, draft, and scope data before a fresh session", () => {
    const draft = { ...buildTaskDraft(task), title: "Unsaved change" };
    const states = [
      edit(),
      taskEditorFlowReducer(edit(), { draft, type: "save" }),
      taskEditorFlowReducer(edit(), { type: "delete" }),
      taskEditorFlowReducer(
        { kind: "closed" },
        { initial: draft, sessionId: "session-a", type: "openCreate" }
      ),
    ];
    for (const state of states) {
      const closed = taskEditorFlowReducer(state, { type: "close" });
      expect(closed).toEqual({ kind: "closed" });
      const initial = buildTaskDraft(task);
      expect(
        taskEditorFlowReducer(closed, {
          initial,
          sessionId: "session-b",
          type: "openCreate",
        })
      ).toEqual({ initial, kind: "create", sessionId: "session-b" });
    }
  });

  test("recurrence edits on an occurrence default to following; core edits default to this", () => {
    const occurrence = { ...task, id: "occurrence-a" };
    const initial = buildTaskDraft(occurrence);
    const draft = {
      ...initial,
      recurrence: { freq: "DAILY", interval: 2 } as const,
    };
    expect(
      taskEditorFlowReducer(edit(occurrence), { draft, type: "save" })
    ).toEqual({
      draft,
      kind: "saveScope",
      scope: "following",
      task: occurrence,
    });
    expect(
      taskEditorFlowReducer(edit(occurrence), {
        draft: { ...initial, title: "Edited occurrence" },
        type: "save",
      })
    ).toMatchObject({ kind: "saveScope", scope: "this" });
  });

  test("a new delete prompt resets the scope and cannot retain a saved draft", () => {
    const pendingSave = taskEditorFlowReducer(edit(), {
      draft: { ...buildTaskDraft(task), title: "Edited" },
      type: "save",
    });
    const initial = buildTaskDraft(task);
    expect(
      taskEditorFlowReducer(pendingSave, {
        initial,
        sessionId: "session-b",
        type: "openCreate",
      })
    ).toEqual({ initial, kind: "create", sessionId: "session-b" });
    const pendingDelete = taskEditorFlowReducer(edit(), { type: "delete" });
    const selected = taskEditorFlowReducer(pendingDelete, {
      scope: "following",
      type: "setScope",
    });
    expect(selected).toEqual({ kind: "deleteScope", scope: "following", task });
    const reopened = taskEditorFlowReducer(selected, {
      sessionId: "session-c",
      task,
      type: "openEdit",
    });
    expect(taskEditorFlowReducer(reopened, { type: "delete" })).toEqual({
      kind: "deleteScope",
      scope: "this",
      task,
    });
  });

  test("immediate save and delete discard the session, including for unchanged recurring edits", () => {
    const standalone = { ...task, recurrence: null, seriesMasterId: null };
    expect(
      taskEditorFlowReducer(edit(standalone), {
        draft: { ...buildTaskDraft(standalone), title: "Updated" },
        type: "save",
      })
    ).toEqual({ kind: "closed" });
    expect(taskEditorFlowReducer(edit(standalone), { type: "delete" })).toEqual(
      {
        kind: "closed",
      }
    );
    expect(
      taskEditorFlowReducer(edit(), {
        draft: buildTaskDraft(task),
        type: "save",
      })
    ).toEqual({ kind: "closed" });
    const creating = taskEditorFlowReducer(
      { kind: "closed" },
      {
        initial: buildTaskDraft(standalone),
        sessionId: "session-b",
        type: "openCreate",
      }
    );
    expect(
      taskEditorFlowReducer(creating, {
        draft: buildTaskDraft(standalone),
        type: "save",
      })
    ).toEqual({ kind: "closed" });
  });

  test("invalid saves preserve the editor and cannot open a scope prompt", () => {
    const editing = edit();
    for (const draft of [
      { ...buildTaskDraft(task), title: "  " },
      { ...buildTaskDraft(task), durationMinutes: 0 },
    ]) {
      expect(taskEditorFlowReducer(editing, { draft, type: "save" })).toBe(
        editing
      );
    }
  });

  test("actions from a dismissed editor cannot revive a draft or scope dialog", () => {
    const closed: TaskEditorState = { kind: "closed" };
    expect(
      taskEditorFlowReducer(closed, {
        draft: buildTaskDraft(task),
        type: "save",
      })
    ).toBe(closed);
    expect(taskEditorFlowReducer(closed, { type: "delete" })).toBe(closed);
    expect(
      taskEditorFlowReducer(closed, { scope: "following", type: "setScope" })
    ).toBe(closed);
  });
});
