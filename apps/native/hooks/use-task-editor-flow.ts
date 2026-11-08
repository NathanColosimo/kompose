import type {
  DeleteScope,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
  resolveTaskRecurrenceForEditor,
} from "@kompose/state/task-recurrence";
import { useCallback, useState } from "react";
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
    setScopeDialog(null);
  }

  function updateDraft(updater: (previous: TaskDraft) => TaskDraft) {
    setDraft((current) => (current ? updater(current) : current));
  }

  function commitUpdate(nextDraft: TaskDraft, scope: UpdateScope) {
    if (!editingTask) {
      return;
    }

    updateTask.mutate({
      id: editingTask.id,
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
        description: editingTask.description,
        dueDate: editingTask.dueDate,
        durationMinutes: editingTask.durationMinutes,
        startDate: editingTask.startDate,
        startTime: editingTask.startTime,
        title: editingTask.title,
      },
    });

    const decision = getTaskUpdateScopeDecision({
      hasCoreFieldChanges,
      hasFollowing: editingTask.startDate !== null,
      isRecurring: editingTask.seriesMasterId !== null,
      nextRecurrence: draft.recurrence,
      nextTagIds: draft.tagIds,
      previousRecurrence: editingTask.recurrence,
      previousTagIds: editingTask.tags.map((tag) => tag.id),
    });

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

  function confirmScopedSave() {
    if (!(editingTask && pendingSaveDraft)) {
      return;
    }
    commitUpdate(pendingSaveDraft, saveScope);
    close();
  }

  function confirmScopedDelete() {
    if (!editingTask) {
      return;
    }
    deleteTask.mutate({ id: editingTask.id, scope: deleteScope });
    close();
  }

  function toggleDone(nextStatus: TaskDraft["status"]) {
    if (!editingTask) {
      return;
    }
    updateTask.mutate({
      id: editingTask.id,
      scope: "this",
      task: { status: nextStatus },
    });
    close();
  }

  return {
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
