import type {
  DeleteScope,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
  haveTaskTagIdsChanged,
  resolveTaskRecurrenceForEditor,
  taskRecurrenceEquals,
  taskStatusSavePlan,
} from "@kompose/state/task-recurrence";
import { useCallback, useRef, useState } from "react";
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

function trimmedDescription(draft: TaskDraft): string | null {
  return draft.description.trim() ? draft.description.trim() : null;
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
  const [pendingSaveDraft, setPendingSaveDraft] = useState<TaskDraft | null>(
    null
  );
  const [saveScope, setSaveScope] = useState<UpdateScope>("this");
  /**
   * Cancelling the save scope dialog goes back to the editor, edits kept.
   * A ref: the dialog's close callback is captured before the cancel.
   */
  const reopenEditorRef = useRef(false);
  /** Mark done is saving the editor's edits; the editor stays open. */
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  /** Mark done (or not done) waiting on the scope dialog with the edits. */
  const [pendingStatus, setPendingStatus] = useState<
    TaskDraft["status"] | null
  >(null);
  const [deleteScope, setDeleteScope] = useState<DeleteScope>("this");

  // Stable so callers can use it in effect dependencies.
  const openCreate = useCallback((nextDraft: TaskDraft) => {
    setEditingTask(null);
    setPendingSaveDraft(null);
    setScopeDialog(null);
    setDraft(nextDraft);
    setIsEditorOpen(true);
  }, []);

  function openEdit(task: TaskSelectDecoded) {
    const nextEditingTask: TaskSelectDecoded = {
      ...task,
      recurrence: resolveTaskRecurrenceForEditor(task, tasksQuery.data ?? []),
    };
    setEditingTask(nextEditingTask);
    setDraft(buildDraftFromTask(nextEditingTask));
    setIsEditorOpen(true);
  }

  function close() {
    setIsEditorOpen(false);
    setEditingTask(null);
    setPendingSaveDraft(null);
    setPendingStatus(null);
    setScopeDialog(null);
  }

  function updateDraft(updater: (previous: TaskDraft) => TaskDraft) {
    setDraft((current) => (current ? updater(current) : current));
  }

  /** Saves the draft (plus `status`); resolves to whether it saved. */
  function commitUpdate(
    nextDraft: TaskDraft,
    scope: UpdateScope,
    status?: TaskDraft["status"]
  ): Promise<boolean> {
    if (!editingTask) {
      return Promise.resolve(false);
    }

    return updateTask
      .mutateAsync({
        id: editingTask.id,
        scope,
        task: {
          ...(status ? { status } : {}),
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
      })
      .then(
        () => true,
        () => false
      );
  }

  /** Saves the draft with a status change, the same way as on web. */
  function commitWithStatus(
    nextDraft: TaskDraft,
    scope: UpdateScope,
    status: TaskDraft["status"]
  ): Promise<boolean> {
    if (!editingTask) {
      return Promise.resolve(false);
    }
    const plan = taskStatusSavePlan({
      nextRecurrence: nextDraft.recurrence,
      previousRecurrence: editingTask.recurrence,
      scope,
    });
    if (plan === "with-edits") {
      return commitUpdate(nextDraft, scope, status);
    }
    const { id } = editingTask;
    return commitUpdate(nextDraft, scope).then((saved) => {
      if (saved) {
        updateTask.mutate({ id, scope: "this", task: { status } });
      }
      return saved;
    });
  }

  /** The scope decision for saving `nextDraft` over the task being edited. */
  function scopeDecisionFor(nextDraft: TaskDraft, task: TaskSelectDecoded) {
    const hasCoreFieldChanges = haveTaskCoreFieldsChanged({
      next: {
        description: nextDraft.description,
        dueDate: nextDraft.dueDate,
        durationMinutes: nextDraft.durationMinutes,
        startDate: nextDraft.startDate,
        startTime: nextDraft.startTime,
        title: nextDraft.title,
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
    const hasChanges =
      hasCoreFieldChanges ||
      JSON.stringify(task.links ?? []) !== JSON.stringify(nextDraft.links) ||
      !taskRecurrenceEquals(task.recurrence, nextDraft.recurrence) ||
      haveTaskTagIdsChanged(
        task.tags.map((tag) => tag.id),
        nextDraft.tagIds
      );
    return {
      decision: getTaskUpdateScopeDecision({
        hasCoreFieldChanges,
        isRecurring: task.seriesMasterId !== null,
        isSeriesMaster: task.seriesMasterId === task.id,
        nextRecurrence: nextDraft.recurrence,
        nextTagIds: nextDraft.tagIds,
        previousRecurrence: task.recurrence,
        previousTagIds: task.tags.map((tag) => tag.id),
      }),
      hasChanges,
    };
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

  function save() {
    if (!draft) {
      return;
    }
    if (!draft.title.trim() && draft.links.length === 0) {
      return;
    }
    if (draft.durationMinutes <= 0) {
      return;
    }

    if (!editingTask) {
      create(draft);
      close();
      return;
    }

    const { decision } = scopeDecisionFor(draft, editingTask);

    if (decision.action === "prompt") {
      setPendingSaveDraft(draft);
      setSaveScope(decision.defaultScope);
      setIsEditorOpen(false);
      setScopeDialog("save");
      return;
    }

    commitUpdate(draft, decision.scope);
    close();
  }

  function requestDelete() {
    if (!editingTask) {
      return;
    }

    if (editingTask.seriesMasterId) {
      setDeleteScope("this");
      setIsEditorOpen(false);
      setScopeDialog("delete");
      return;
    }

    deleteTask.mutate({ id: editingTask.id, scope: "this" });
    close();
  }

  /**
   * Cancel in the save scope dialog: back to the editor with the edits (and
   * the old done state), once the dialog has gone.
   */
  function cancelScopedSave() {
    if (!(editingTask && pendingSaveDraft)) {
      close();
      return;
    }
    setDraft({ ...pendingSaveDraft, status: editingTask.status });
    setPendingSaveDraft(null);
    setPendingStatus(null);
    reopenEditorRef.current = true;
    setScopeDialog(null);
  }

  /** The save scope dialog's own close: a cancel keeps the editor going. */
  function closeScopeDialog() {
    if (reopenEditorRef.current) {
      setScopeDialog(null);
      return;
    }
    close();
  }

  function handleScopeDialogDismissed() {
    if (reopenEditorRef.current) {
      reopenEditorRef.current = false;
      setIsEditorOpen(true);
    }
  }

  function confirmScopedSave() {
    if (!(editingTask && pendingSaveDraft)) {
      return;
    }
    if (!pendingStatus) {
      commitUpdate(pendingSaveDraft, saveScope);
      close();
      return;
    }
    // With Mark done, the editor comes back (saving) once the dialog has
    // gone, and closes when the save succeeds; a failed save keeps the edits.
    const savedDraft = pendingSaveDraft;
    const { status } = editingTask;
    setDraft(savedDraft);
    setPendingSaveDraft(null);
    setPendingStatus(null);
    reopenEditorRef.current = true;
    setScopeDialog(null);
    setIsSavingStatus(true);
    commitWithStatus(savedDraft, saveScope, pendingStatus).then((saved) => {
      setIsSavingStatus(false);
      if (saved) {
        reopenEditorRef.current = false;
        close();
        return;
      }
      updateDraft((current) => ({ ...current, status }));
    });
  }

  function confirmScopedDelete() {
    if (!editingTask) {
      return;
    }
    deleteTask.mutate({ id: editingTask.id, scope: deleteScope });
    close();
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
    const { decision, hasChanges } = scopeDecisionFor(draft, editingTask);
    if (!hasChanges) {
      updateTask.mutate({
        id: editingTask.id,
        scope: "this",
        task: { status: nextStatus },
      });
      close();
      return;
    }
    if (decision.action === "prompt") {
      setPendingSaveDraft(draft);
      setPendingStatus(nextStatus);
      setSaveScope(decision.defaultScope);
      setIsEditorOpen(false);
      setScopeDialog("save");
      return;
    }
    // The editor stays open until the edits have saved, so a failed save
    // keeps them.
    setIsSavingStatus(true);
    commitWithStatus(draft, decision.scope, nextStatus).then((saved) => {
      setIsSavingStatus(false);
      if (saved) {
        close();
        return;
      }
      // Still open with the edits; the checkbox goes back too.
      updateDraft((current) => ({ ...current, status: editingTask.status }));
    });
  }

  return {
    cancelScopedSave,
    close,
    closeScopeDialog,
    confirmScopedDelete,
    confirmScopedSave,
    deleteScope,
    draft,
    editingTask,
    handleScopeDialogDismissed,
    isEditorOpen,
    isSavingStatus,
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
