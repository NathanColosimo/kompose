import type {
  DeleteScope,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  canSaveTaskDraft,
  getTaskDraftUpdateScopeDecision,
  type TaskDraft,
  taskEditorFlowReducer,
} from "@kompose/state/task-editor-flow";
import { resolveTaskRecurrenceForEditor } from "@kompose/state/task-recurrence";
import { useCallback, useReducer } from "react";
import { uuidv7 } from "uuidv7";

function trimmedDescription(draft: TaskDraft): string | null {
  return draft.description.trim() ? draft.description.trim() : null;
}

/** Shared task editor orchestration; see documents/mobile-task-popover.md. */
export function useTaskEditorFlow() {
  const { tasksQuery, createTask, updateTask, deleteTask } = useTasks();
  const [state, dispatch] = useReducer(taskEditorFlowReducer, {
    kind: "closed",
  });

  // Stable so callers can use it in effect dependencies.
  const openCreate = useCallback((initial: TaskDraft) => {
    dispatch({ initial, sessionId: uuidv7(), type: "openCreate" });
  }, []);

  function openEdit(task: TaskSelectDecoded) {
    dispatch({
      sessionId: uuidv7(),
      task: {
        ...task,
        recurrence: resolveTaskRecurrenceForEditor(task, tasksQuery.data ?? []),
      },
      type: "openEdit",
    });
  }

  function close() {
    dispatch({ type: "close" });
  }

  function commitUpdate(
    task: TaskSelectDecoded,
    nextDraft: TaskDraft,
    scope: UpdateScope
  ) {
    updateTask.mutate({
      id: task.id,
      scope,
      task: {
        description: trimmedDescription(nextDraft),
        dueDate: nextDraft.dueDate,
        durationMinutes: nextDraft.durationMinutes,
        links: nextDraft.links,
        recurrence: nextDraft.recurrence,
        startDate: nextDraft.startDate,
        startTime: nextDraft.startTime,
        tagIds: nextDraft.tagIds,
        title: nextDraft.title.trim(),
      },
    });
  }

  function create(nextDraft: TaskDraft) {
    let title = nextDraft.title.trim();
    if (!title && nextDraft.links.length > 0) {
      const first = nextDraft.links[0];
      title = first.title ?? new URL(first.url).hostname;
    }

    createTask.mutate({
      description: trimmedDescription(nextDraft),
      dueDate: nextDraft.dueDate,
      durationMinutes: nextDraft.durationMinutes,
      isException: false,
      links: nextDraft.links,
      recurrence: nextDraft.recurrence,
      seriesMasterId: null,
      startDate: nextDraft.startDate,
      startTime: nextDraft.startTime,
      status: "todo",
      tagIds: nextDraft.tagIds,
      title,
    });
  }

  function save(draft: TaskDraft) {
    if (
      (state.kind !== "create" && state.kind !== "edit") ||
      !canSaveTaskDraft(draft)
    ) {
      return;
    }

    if (state.kind === "create") {
      create(draft);
    } else {
      const decision = getTaskDraftUpdateScopeDecision(state.task, draft);
      if (decision.action === "apply") {
        commitUpdate(state.task, draft, decision.scope);
      }
    }
    dispatch({ draft, type: "save" });
  }

  function requestDelete() {
    if (state.kind !== "edit") {
      return;
    }
    if (!state.task.seriesMasterId) {
      deleteTask.mutate({ id: state.task.id, scope: "this" });
    }
    dispatch({ type: "delete" });
  }

  function confirmScopedSave() {
    if (state.kind !== "saveScope") {
      return;
    }
    commitUpdate(state.task, state.draft, state.scope);
    close();
  }

  function confirmScopedDelete() {
    if (state.kind !== "deleteScope") {
      return;
    }
    deleteTask.mutate({ id: state.task.id, scope: state.scope });
    close();
  }

  function setScope(scope: UpdateScope | DeleteScope) {
    dispatch({ scope, type: "setScope" });
  }

  function toggleDone(nextStatus: TaskDraft["status"]) {
    if (state.kind !== "edit") {
      return;
    }
    updateTask.mutate({
      id: state.task.id,
      scope: "this",
      task: { status: nextStatus },
    });
    close();
  }

  return {
    close,
    confirmScopedDelete,
    confirmScopedSave,
    openCreate,
    openEdit,
    requestDelete,
    save,
    setScope,
    state,
    toggleDone,
  };
}

export type TaskEditorFlow = ReturnType<typeof useTaskEditorFlow>;
