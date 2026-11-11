import type {
  DeleteScope,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { SCOPE_DIALOG_COPY } from "@kompose/state/recurrence-scope-options";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
  haveTaskTagIdsChanged,
  resolveTaskRecurrenceForEditor,
  taskRecurrenceEquals,
} from "@kompose/state/task-recurrence";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { Temporal } from "temporal-polyfill";
import type { TaskDraft } from "@/components/tasks/task-editor-sheet";

type TaskScopeDialog = "save" | "delete" | null;

function buildDraftFromTask(task: TaskSelectDecoded): TaskDraft {
  return {
    description: task.description ?? "",
    dueDate: task.dueDate,
    durationMinutes: task.durationMinutes,
    linkInput: "",
    links: task.links ?? [],
    recurrence: task.recurrence ?? null,
    startDate: task.startDate,
    startTime: task.startTime,
    status: task.status,
    tagIds: task.tags.map((tag) => tag.id),
    title: task.title,
  };
}

/** The title as typed, or the first link's title (or host) when blank. */
function resolvedTitle(draft: TaskDraft): string {
  const title = draft.title.trim();
  const first = draft.links[0];
  if (title || !first) {
    return title;
  }
  return first.title ?? new URL(first.url).hostname;
}

/** The scope decision for saving `draft` over `task`, and whether it changed. */
function scopeDecisionFor(draft: TaskDraft, task: TaskSelectDecoded) {
  const hasCoreFieldChanges = haveTaskCoreFieldsChanged({
    next: draft,
    previous: task,
  });
  const previousTagIds = task.tags.map((tag) => tag.id);
  const hasChanges =
    hasCoreFieldChanges ||
    JSON.stringify(task.links ?? []) !== JSON.stringify(draft.links) ||
    !taskRecurrenceEquals(task.recurrence, draft.recurrence) ||
    haveTaskTagIdsChanged(previousTagIds, draft.tagIds);
  return {
    decision: getTaskUpdateScopeDecision({
      hasCoreFieldChanges,
      isSeriesMaster: task.seriesMasterId === task.id,
      isRecurring: task.seriesMasterId !== null,
      nextRecurrence: draft.recurrence,
      nextTagIds: draft.tagIds,
      previousRecurrence: task.recurrence,
      previousTagIds,
    }),
    hasChanges,
  };
}

/** Shared task editor orchestration; see documents/mobile-task-popover.md. */
export function useTaskEditorFlow() {
  const { tasksQuery, createTask, updateTask, deleteTask } = useTasks();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskSelectDecoded | null>(
    null
  );
  const [scopeDialog, setScopeDialog] = useState<TaskScopeDialog>(null);
  /** The draft (with any done change) the save scope dialog will apply. */
  const [pendingSaveDraft, setPendingSaveDraft] = useState<TaskDraft | null>(
    null
  );
  const [saveScope, setSaveScope] = useState<UpdateScope>("this");
  const [deleteScope, setDeleteScope] = useState<DeleteScope>("this");
  const resetSession = useCallback(() => {
    setPendingSaveDraft(null);
    setScopeDialog(null);
  }, []);

  // Stable so callers can use it in effect dependencies.
  const openCreate = useCallback(
    (nextDraft: TaskDraft) => {
      resetSession();
      setEditingTask(null);
      setDraft(nextDraft);
      setIsEditorOpen(true);
    },
    [resetSession]
  );

  function openEdit(task: TaskSelectDecoded) {
    const nextEditingTask: TaskSelectDecoded = {
      ...task,
      recurrence: resolveTaskRecurrenceForEditor(task, tasksQuery.data ?? []),
    };
    resetSession();
    setEditingTask(nextEditingTask);
    setDraft(buildDraftFromTask(nextEditingTask));
    setIsEditorOpen(true);
  }

  // The task stays set until the next open, so the sheet keeps reading
  // "Edit task" (not "New task") while it animates out.
  function close() {
    resetSession();
    setIsEditorOpen(false);
  }

  function updateDraft(updater: (previous: TaskDraft) => TaskDraft) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const next = updater(current);
      if (
        next.startDate &&
        next.recurrence?.until &&
        Temporal.PlainDate.compare(
          next.startDate,
          Temporal.PlainDate.from(next.recurrence.until)
        ) > 0
      ) {
        return {
          ...next,
          recurrence: { ...next.recurrence, until: next.startDate.toString() },
        };
      }
      return next;
    });
  }

  const canSave = Boolean(
    draft &&
      resolvedTitle(draft) &&
      draft.durationMinutes > 0 &&
      (!draft.recurrence || draft.startDate)
  );

  /** Save the draft, including a status change, and close immediately. */
  function commitUpdate(
    task: TaskSelectDecoded,
    nextDraft: TaskDraft,
    scope: UpdateScope
  ) {
    // The status goes on this occurrence alone; the server keeps it when a
    // "following" save also changes the series.
    const statusChanged = nextDraft.status !== task.status;
    updateTask.mutate({
      id: task.id,
      scope,
      task: {
        ...(statusChanged ? { status: nextDraft.status } : {}),
        description: nextDraft.description.trim() || null,
        dueDate: nextDraft.dueDate,
        durationMinutes: nextDraft.durationMinutes,
        links: nextDraft.links,
        recurrence: nextDraft.recurrence,
        startDate: nextDraft.startDate,
        startTime: nextDraft.startTime,
        tagIds: nextDraft.tagIds,
        title: resolvedTitle(nextDraft),
      },
    });
    close();
  }

  function create(nextDraft: TaskDraft) {
    createTask.mutate({
      description: nextDraft.description.trim() || null,
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
      title: resolvedTitle(nextDraft),
    });
    close();
  }

  /** Saves `nextDraft`, through the scope dialog when the task repeats. */
  function saveDraft(task: TaskSelectDecoded, nextDraft: TaskDraft) {
    const { decision } = scopeDecisionFor(nextDraft, task);
    if (decision.action === "prompt") {
      // The dialog opens over the editor, which stays put: Cancel goes
      // straight back to it with the edits.
      setPendingSaveDraft(nextDraft);
      setSaveScope(decision.defaultScope);
      setScopeDialog("save");
      return;
    }
    commitUpdate(task, nextDraft, decision.scope);
  }

  function save() {
    if (!(draft && canSave)) {
      return;
    }
    if (!editingTask) {
      create(draft);
      return;
    }
    saveDraft(editingTask, draft);
  }

  /**
   * Mark done (or not done) from the editor. Unsaved edits are saved with
   * it, through the scope dialog when the task repeats, so they're never
   * dropped.
   */
  function toggleDone(nextStatus: TaskDraft["status"]) {
    if (!(editingTask && draft)) {
      return;
    }
    if (!scopeDecisionFor(draft, editingTask).hasChanges) {
      updateTask.mutate({
        id: editingTask.id,
        scope: "this",
        task: { status: nextStatus },
      });
      close();
      return;
    }
    if (!canSave) {
      return;
    }
    updateDraft((current) => ({ ...current, status: nextStatus }));
    saveDraft(editingTask, { ...draft, status: nextStatus });
  }

  /**
   * Back to the editor underneath any scope dialog, edits kept and the done
   * checkbox as saved on Cancel or a backdrop tap.
   */
  function cancelScopeDialog() {
    if (editingTask) {
      const { status } = editingTask;
      updateDraft((current) => ({ ...current, status }));
    }
    setPendingSaveDraft(null);
    setScopeDialog(null);
  }

  function confirmScopedSave() {
    if (!(editingTask && pendingSaveDraft)) {
      return;
    }
    commitUpdate(editingTask, pendingSaveDraft, saveScope);
  }

  function requestDelete() {
    if (!editingTask) {
      return;
    }

    if (editingTask.seriesMasterId) {
      // Over the editor, like the save dialog: Cancel goes back to it.
      setDeleteScope("this");
      setScopeDialog("delete");
      return;
    }

    // No undo, and the trash sits beside Save: confirm first, as web does.
    const id = editingTask.id;
    const { description, title } = SCOPE_DIALOG_COPY.deleteTaskAlone;
    Alert.alert(title, description, [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          deleteTask.mutate({ id, scope: "this" });
          close();
        },
        style: "destructive",
        text: "Delete",
      },
    ]);
  }

  function confirmScopedDelete() {
    if (!editingTask) {
      return;
    }
    deleteTask.mutate({ id: editingTask.id, scope: deleteScope });
    close();
  }

  return {
    cancelScopeDialog,
    canSave,
    close,
    confirmScopedDelete,
    confirmScopedSave,
    deleteScope,
    draft,
    editingTask,
    isEditorOpen,
    openCreate,
    openEdit,
    requestDelete,
    save,
    saveScope,
    scopeDialog,
    setDeleteScope,
    setSaveScope,
    toggleDone,
    updateDraft,
  };
}

export type TaskEditorFlow = ReturnType<typeof useTaskEditorFlow>;
