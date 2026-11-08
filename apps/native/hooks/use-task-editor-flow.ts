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

function buildTaskPayload(draft: TaskDraft) {
  return {
    description: draft.description.trim() || null,
    dueDate: draft.dueDate,
    durationMinutes: draft.durationMinutes,
    links: draft.links,
    recurrence: draft.recurrence,
    startDate: draft.startDate,
    startTime: draft.startTime,
    tagIds: draft.tagIds,
    title: draft.title.trim(),
  };
}

/** Shared task editor orchestration; see documents/mobile-task-popover.md. */
export function useTaskEditorFlow() {
  const { tasksQuery, createTask, updateTask, deleteTask } = useTasks();
  const [state, dispatch] = useReducer(taskEditorFlowReducer, {
    kind: "closed",
  });

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
      task: buildTaskPayload(nextDraft),
    });
  }

  function create(nextDraft: TaskDraft) {
    let title = nextDraft.title.trim();
    if (!title && nextDraft.links.length > 0) {
      const first = nextDraft.links[0];
      title = first.title ?? new URL(first.url).hostname;
    }

    createTask.mutate({
      ...buildTaskPayload(nextDraft),
      isException: false,
      seriesMasterId: null,
      status: "todo",
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

  function confirmScope() {
    if (state.kind === "saveScope") {
      commitUpdate(state.task, state.draft, state.scope);
    } else if (state.kind === "deleteScope") {
      deleteTask.mutate({ id: state.task.id, scope: state.scope });
    } else {
      return;
    }
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
    confirmScope,
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
