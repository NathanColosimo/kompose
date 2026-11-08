import type {
  DeleteScope,
  TaskRecurrence,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  SAVE_FAILURE_MESSAGE,
  TASK_CREATE_FAILURE_MESSAGE,
} from "@kompose/state/held-save";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { SCOPE_DIALOG_COPY } from "@kompose/state/recurrence-scope-options";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
  haveTaskTagIdsChanged,
  markStatusFailureMessage,
  repeatBlocksSave,
  resolveTaskRecurrenceForEditor,
  taskRecurrenceEquals,
} from "@kompose/state/task-recurrence";
import { useCallback, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Keyboard } from "react-native";
import type { TaskDraft } from "@/components/tasks/task-editor-sheet";

type TaskScopeDialog = "save" | "delete" | null;

/** The series a task being edited belongs to; null when it doesn't repeat. */
export interface TaskSeries {
  /** The series' saved pattern, which a repeat change is measured against. */
  recurrence: TaskRecurrence | null;
  /**
   * An occurrence moved to the inbox (no date): nothing follows it, and a
   * repeat change takes it out of its series.
   */
  undated: boolean;
}

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

function trimmedDescription(draft: TaskDraft): string | null {
  return draft.description.trim() ? draft.description.trim() : null;
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

/**
 * Whether the draft can save (Save, and Mark done, which saves the edits):
 * it needs a title or a link, a duration, and a repeat with occurrences.
 */
function canSaveDraft(draft: TaskDraft, series: TaskSeries | null): boolean {
  if (!resolvedTitle(draft) || draft.durationMinutes <= 0) {
    return false;
  }
  return !repeatBlocksSave({
    next: draft.recurrence,
    previous: series?.recurrence ?? null,
    startDate: draft.startDate,
  });
}

/** The scope decision for saving `draft` over `task`, and whether it changed. */
function scopeDecisionFor(draft: TaskDraft, task: TaskSelectDecoded) {
  const hasCoreFieldChanges = haveTaskCoreFieldsChanged({
    next: {
      description: draft.description,
      dueDate: draft.dueDate,
      durationMinutes: draft.durationMinutes,
      startDate: draft.startDate,
      startTime: draft.startTime,
      title: draft.title,
    },
    previous: {
      description: task.description,
      dueDate: task.dueDate,
      durationMinutes: task.durationMinutes,
      startDate: task.startDate,
      startTime: task.startTime,
      title: task.title,
    },
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
      // Later occurrences follow only a dated one that stays dated: moving
      // an occurrence to the inbox affects it alone, so there's no scope to
      // ask.
      hasFollowing: task.startDate !== null && draft.startDate !== null,
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
  /** A save is running; the editor holds open (read-only) until it ends. */
  const [isSaving, setIsSaving] = useState(false);
  /**
   * The editor session: bumped on every open and close, so a save that
   * resolves later only acts on the session it started in (not a closed
   * editor, another task, or the same task reopened).
   */
  const sessionRef = useRef(0);

  /** Ends the current session and resets everything it held. */
  const resetSession = useCallback(() => {
    sessionRef.current += 1;
    setIsSaving(false);
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
    setDraft((current) => (current ? updater(current) : current));
  }

  const series: TaskSeries | null = editingTask?.seriesMasterId
    ? {
        recurrence: editingTask.recurrence,
        undated: !editingTask.startDate,
      }
    : null;
  const canSave = Boolean(draft && !isSaving && canSaveDraft(draft, series));

  /**
   * Saves the draft over `task`, with its done state when that changed.
   * Resolves to whether it saved. Not optimistic: the editor holds open on
   * it, so the cache waits for the server instead of rolling back over the
   * draft on failure.
   */
  function commitUpdate(
    task: TaskSelectDecoded,
    nextDraft: TaskDraft,
    scope: UpdateScope
  ): Promise<boolean> {
    // The status goes on this occurrence alone; the server keeps it when a
    // "following" save also changes the series.
    const statusChanged = nextDraft.status !== task.status;
    return updateTask
      .mutateAsync({
        failureMessage: statusChanged
          ? markStatusFailureMessage(nextDraft.status)
          : SAVE_FAILURE_MESSAGE,
        id: task.id,
        optimistic: false,
        scope,
        task: {
          ...(statusChanged ? { status: nextDraft.status } : {}),
          description: trimmedDescription(nextDraft),
          dueDate: nextDraft.dueDate,
          durationMinutes: nextDraft.durationMinutes,
          links: nextDraft.links,
          // Sent only when it changed: an explicit null ends the repeat, so
          // an untouched occurrence must not send one.
          recurrence: taskRecurrenceEquals(
            task.recurrence,
            nextDraft.recurrence
          )
            ? undefined
            : nextDraft.recurrence,
          startDate: nextDraft.startDate,
          startTime: nextDraft.startTime,
          tagIds: nextDraft.tagIds,
          title: resolvedTitle(nextDraft),
        },
      })
      .then(
        () => true,
        () => false
      );
  }

  /** Resolves true once the task is created. */
  function create(nextDraft: TaskDraft): Promise<boolean> {
    return createTask
      .mutateAsync({
        description: trimmedDescription(nextDraft),
        dueDate: nextDraft.dueDate,
        durationMinutes: nextDraft.durationMinutes,
        failureMessage: TASK_CREATE_FAILURE_MESSAGE,
        isException: false,
        links: nextDraft.links,
        recurrence: nextDraft.recurrence,
        seriesMasterId: null,
        startDate: nextDraft.startDate,
        startTime: nextDraft.startTime,
        status: "todo",
        tagIds: nextDraft.tagIds,
        title: resolvedTitle(nextDraft),
      })
      .then(
        () => true,
        () => false
      );
  }

  /**
   * Holds the editor (and any scope dialog, its Apply reading "Saving…")
   * until `saved` resolves: then everything closes, or on failure the
   * dialog goes and the editor keeps the edits, with its done state as
   * saved.
   */
  function holdUntil(saved: Promise<boolean>) {
    Keyboard.dismiss();
    AccessibilityInfo.announceForAccessibility("Saving…");
    setIsSaving(true);
    const task = editingTask;
    const session = sessionRef.current;
    saved.then((ok) => {
      if (sessionRef.current !== session) {
        return;
      }
      if (ok) {
        close();
        return;
      }
      setIsSaving(false);
      if (task) {
        updateDraft((current) => ({ ...current, status: task.status }));
      }
      setPendingSaveDraft(null);
      setScopeDialog(null);
    });
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
    holdUntil(commitUpdate(task, nextDraft, decision.scope));
  }

  function save() {
    if (!(draft && canSave)) {
      return;
    }
    if (!editingTask) {
      holdUntil(create(draft));
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
   * Cancel (or a backdrop tap) in a scope dialog: back to the editor
   * underneath, edits kept, and the done checkbox as it was.
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
    holdUntil(commitUpdate(editingTask, pendingSaveDraft, saveScope));
  }

  function requestDelete() {
    if (!editingTask) {
      return;
    }

    // An occurrence moved to the inbox has nothing after it: no scope to ask.
    if (editingTask.seriesMasterId && editingTask.startDate) {
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
    isSaving,
    openCreate,
    openEdit,
    requestDelete,
    save,
    saveScope,
    scopeDialog,
    series,
    setDeleteScope,
    setSaveScope,
    toggleDone,
    updateDraft,
  };
}

export type TaskEditorFlow = ReturnType<typeof useTaskEditorFlow>;
