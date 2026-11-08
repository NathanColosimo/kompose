"use client";

import type {
  ClientTaskInsertDecoded,
  DeleteScope,
  LinkMeta,
  TaskRecurrence,
  TaskSelectDecoded,
  TaskUpdateDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { commandBarTaskOpenRequestAtom } from "@kompose/state/atoms/command-bar";
import {
  SAVE_FAILURE_MESSAGE,
  TASK_CREATE_FAILURE_MESSAGE,
} from "@kompose/state/held-save";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  dedupeLinks,
  getLinkDurationMinutes,
  getLinkWordCount,
  getProviderLabel,
  URL_REGEX,
} from "@kompose/state/link-meta-utils";
import {
  SCOPE_DIALOG_COPY,
  TASK_UPDATE_SCOPE_OPTIONS,
} from "@kompose/state/recurrence-scope-options";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
  markStatusFailureMessage,
  repeatBlocksSave,
  repeatNote,
  resolveTaskRecurrenceForEditor,
  taskRecurrenceEquals,
} from "@kompose/state/task-recurrence";
import { useAtom, useAtomValue } from "jotai";
import {
  CalendarCheck,
  CalendarClock,
  Check,
  Link2,
  Loader2,
  Trash2,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Controller,
  type UseFormReturn,
  type UseFormSetValue,
  useForm,
  useWatch,
} from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { Temporal } from "temporal-polyfill";
import { RecurrenceScopeDialog } from "@/components/recurrence-scope-dialog";
import { TagPicker } from "@/components/tags/tag-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DurationPicker } from "@/components/ui/duration-picker";
import { HeldFieldset, SaveFailure } from "@/components/ui/held-fieldset";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import {
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { isNarrowViewportAtom } from "@/state/sidebar";
import type {
  CalendarCreateFormInterop,
  CalendarCreateSharedFields,
} from "../calendar/event-creation/create-form-shared";
import { Label } from "../ui/label";
import { RecurrenceEditor } from "./recurrence-editor";

/** Form state uses Temporal types, convert to native Date only at picker boundary */
export interface TaskFormValues {
  description: string;
  dueDate: Temporal.PlainDate | null;
  durationMinutes: number;
  links: LinkMeta[];
  recurrence: TaskRecurrence | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
  tagIds: string[];
  title: string;
}

interface TaskEditPopoverProps {
  align?: "start" | "center" | "end";
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  surface: "calendar" | "sidebar";
  task: TaskSelectDecoded;
}

const EMPTY_TASK_FORM_VALUES: TaskFormValues = {
  description: "",
  dueDate: null,
  durationMinutes: 30,
  links: [],
  recurrence: null,
  startDate: null,
  startTime: null,
  tagIds: [],
  title: "",
};

function buildTaskCreateValues(
  initialValues: Partial<TaskFormValues>
): TaskFormValues {
  const initialDuration = initialValues.durationMinutes;
  return {
    ...EMPTY_TASK_FORM_VALUES,
    ...initialValues,
    durationMinutes:
      typeof initialDuration === "number" && initialDuration > 0
        ? Math.round(initialDuration)
        : EMPTY_TASK_FORM_VALUES.durationMinutes,
  };
}

function buildTaskEditValues(
  task: TaskSelectDecoded,
  recurrence: TaskRecurrence | null
): TaskFormValues {
  return {
    description: task.description ?? "",
    dueDate: task.dueDate ?? null,
    durationMinutes: task.durationMinutes ?? 30,
    links: task.links ?? [],
    recurrence,
    startDate: task.startDate ?? null,
    startTime: task.startTime ?? null,
    tagIds: task.tags.map((tag) => tag.id),
    title: task.title ?? "",
  };
}

function buildTaskCreatePayload(
  values: TaskFormValues
): ClientTaskInsertDecoded | null {
  let title = values.title.trim();
  if (!title && values.links.length > 0) {
    const first = values.links[0];
    title = first.title ?? new URL(first.url).hostname;
  }

  if (!title) {
    return null;
  }

  return {
    description: values.description.trim() ? values.description.trim() : null,
    dueDate: values.dueDate,
    durationMinutes:
      Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
        ? Math.round(values.durationMinutes)
        : 30,
    isException: false,
    links: values.links,
    recurrence: values.recurrence,
    seriesMasterId: null,
    startDate: values.startDate,
    startTime: values.startTime,
    status: "todo",
    tagIds: values.tagIds,
    title,
  };
}

function getSharedFieldsFromTaskValues(
  values: TaskFormValues
): CalendarCreateSharedFields {
  return {
    description: values.description,
    durationMinutes:
      Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
        ? Math.round(values.durationMinutes)
        : 30,
    startDate: values.startDate ? temporalToPickerDate(values.startDate) : null,
    startTime: values.startTime
      ? `${String(values.startTime.hour).padStart(2, "0")}:${String(
          values.startTime.minute
        ).padStart(2, "0")}`
      : "",
    title: values.title,
  };
}

/** See documents/task-popover.md for Save/Cancel and creation-popover behavior. */
export function TaskEditPopover({
  task,
  children,
  surface,
  side = "right",
  align = "start",
}: TaskEditPopoverProps) {
  const [open, setOpen] = useState(false);
  const isNarrow = useAtomValue(isNarrowViewportAtom);
  const [openRequest, setOpenRequest] = useAtom(commandBarTaskOpenRequestAtom);
  const matchesOpenRequest =
    openRequest?.taskId === task.id && openRequest.target === surface;

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);
  const hold = useHeldSave({ editorRef: contentRef, onClose: handleCancel });
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      // Focus moves into the editor, so Tab reaches its fields, but not to
      // the title: there Backspace would edit it instead of deleting the task.
      event.preventDefault();
      contentRef.current?.focus();
      if (!(matchesOpenRequest && openRequest)) {
        return;
      }

      setOpen(true);
      setOpenRequest((currentRequest) =>
        currentRequest?.requestId === openRequest.requestId
          ? null
          : currentRequest
      );
    },
    [matchesOpenRequest, openRequest, setOpenRequest]
  );

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
        }
      }}
      open={open || matchesOpenRequest}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="max-h-(--radix-popover-content-available-height) w-[360px] max-w-[calc(100vw-16px)] space-y-3 overflow-y-auto p-4"
        collisionPadding={8}
        // While a save runs, the editor holds: closing would drop the edits
        // if it fails.
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          if (hold.saving === null) {
            handleCancel();
          }
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          if (hold.saving === null) {
            handleCancel();
          }
        }}
        onOpenAutoFocus={handleOpenAutoFocus}
        ref={contentRef}
        // A phone has no room beside the task, and Radix only slides a side
        // placement up or down, so the editor opens below it instead.
        side={isNarrow ? "bottom" : side}
      >
        <TaskEditForm
          hold={hold}
          key={task.id}
          onClose={handleCancel}
          open={open}
          task={task}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A move or resize while the editor is open updates its times, keeping any
 * other unsaved edits, so Save can't write the old times back.
 */
function useSyncedSchedule(
  task: TaskSelectDecoded,
  setValue: UseFormSetValue<TaskFormValues>
) {
  const scheduleKey = `${task.startDate}|${task.startTime}|${task.durationMinutes}`;
  const lastScheduleKeyRef = useRef(scheduleKey);
  useEffect(() => {
    if (scheduleKey === lastScheduleKeyRef.current) {
      return;
    }
    lastScheduleKeyRef.current = scheduleKey;
    setValue("startDate", task.startDate ?? null);
    setValue("startTime", task.startTime ?? null);
    setValue("durationMinutes", task.durationMinutes);
  }, [scheduleKey, setValue, task]);
}

/**
 * Cancel and Save. While a save runs, leaving would drop the edits if it
 * fails, so both wait until it's done.
 */
function TaskEditorCloseActions({
  onCancel,
  onSave,
  saveBlocked,
  saving,
}: {
  onCancel: () => void;
  onSave: () => void;
  /** The form can't be saved as is; the form says why. */
  saveBlocked: boolean;
  saving: "done" | "save" | null;
}) {
  return (
    <div className="ml-auto flex gap-2">
      <Button
        disabled={saving !== null}
        onClick={onCancel}
        size="sm"
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
      <Button
        disabled={saving !== null || saveBlocked}
        onClick={onSave}
        size="sm"
        type="button"
      >
        <SavingLabel saving={saving === "save"}>Save</SavingLabel>
      </Button>
    </div>
  );
}

/**
 * A series occurrence moved to the inbox (no date): nothing follows it,
 * and a repeat change takes it out of its series.
 */
function isUndatedMember(task: TaskSelectDecoded): boolean {
  return Boolean(task.seriesMasterId && !task.startDate);
}

/** A dated series occurrence, which "this and following" can start from. */
function hasFollowing(task: TaskSelectDecoded): boolean {
  return Boolean(task.seriesMasterId && task.startDate);
}

/** Mark done waits while Save runs, or while the repeat can't save. */
function isDoneBlocked(saving: "done" | "save" | null, repeatBlocked: boolean) {
  return saving === "save" || repeatBlocked;
}

/**
 * Cmd+Enter saves the open editor, but not while it saves, and not behind
 * a dialog over it (the scope or delete question), where it would re-ask
 * and drop the choice made in it.
 */
function canSaveFromKeyboard(params: {
  dialogOpen: boolean;
  open: boolean;
  saving: boolean;
}): boolean {
  return params.open && !params.saving && !params.dialogOpen;
}

/**
 * Holds an editor open on a save, for Mark done ("done") or Save ("save"):
 * it closes when the save succeeds and keeps the draft if not. Owned by the
 * popover, whose Escape and outside clicks wait for it too.
 */
export function useHeldSave({
  editorRef,
  onClose,
}: {
  /** The popover content: it keeps focus while the editor holds. */
  editorRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<"done" | "save">("save");
  const holdOpen = useCallback(
    (nextKind: "done" | "save", save: Promise<boolean>) => {
      // The fields remount read-only (HeldFieldset), which would drop focus
      // to the page, where the calendar's keys could navigate away from the
      // save; the editor itself holds it instead.
      editorRef.current?.focus();
      setKind(nextKind);
      startTransition(async () => {
        if (await save) {
          onClose();
        }
      });
    },
    [editorRef, onClose]
  );
  return { editorRef, holdOpen, saving: isPending ? kind : null };
}

type HeldSave = ReturnType<typeof useHeldSave>;

/** What the repeat will do, or why it can't save (repeatNote). */
function RepeatNote({
  note,
}: {
  note: { blocking: boolean; text: string } | null;
}) {
  if (!note) {
    return null;
  }
  return (
    <p
      className={cn(
        "text-xs",
        note.blocking ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {note.text}
    </p>
  );
}

/**
 * A button's label, or "Saving…" while its save runs. Both share one cell,
 * so the button keeps the wider one's width and nothing beside it shifts.
 */
export function SavingLabel({
  children,
  saving,
}: {
  children: ReactNode;
  saving: boolean;
}) {
  return (
    <span className="grid justify-items-center">
      <span
        className={cn(
          "col-start-1 row-start-1 flex items-center gap-1.5",
          saving && "invisible"
        )}
      >
        {children}
      </span>
      <span className={cn("col-start-1 row-start-1", !saving && "invisible")}>
        Saving…
      </span>
    </span>
  );
}

/** Done / Not done; narrow calendar blocks hide their checkbox, so it's here too. */
function TaskDoneButton({
  disabled,
  isDone,
  isSaving,
  onClick,
}: {
  /** Another save (Save) is running. */
  disabled: boolean;
  isDone: boolean;
  /** Saving the editor's edits with it; the editor closes once saved. */
  isSaving: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      disabled={disabled || isSaving}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      <SavingLabel saving={isSaving}>
        {isDone ? (
          <Undo2 className="size-3.5" />
        ) : (
          <Check className="size-3.5" />
        )}
        {isDone ? "Mark not done" : "Mark done"}
      </SavingLabel>
    </Button>
  );
}

/** Edits a task: Save, Mark done and Delete, with the scope question for a series. */
export function TaskEditForm({
  task,
  onClose,
  hold,
  open,
}: {
  task: TaskSelectDecoded;
  onClose: () => void;
  /** The popover's held save (see useHeldSave). */
  hold: HeldSave;
  open: boolean;
}) {
  const { updateTask, deleteTask, tasksQuery } = useTasks();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTagScopeDialog, setShowTagScopeDialog] = useState(false);
  const [tagScope, setTagScope] = useState<UpdateScope>("this");
  const pendingUpdateRef = useRef<TaskFormValues | null>(null);
  /** Mark done waiting on the scope dialog for the edits saved with it. */
  const pendingStatusRef = useRef<TaskSelectDecoded["status"] | null>(null);
  /** The editor's focused field when the scope dialog opened. */
  const focusBeforeScopeRef = useRef<HTMLElement | null>(null);
  const askScope = useCallback((defaultScope: UpdateScope) => {
    // Where the user was (the title, Save), for a Cancel to return to.
    focusBeforeScopeRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setTagScope(defaultScope);
    setShowTagScopeDialog(true);
  }, []);
  const { holdOpen, saving } = hold;
  /** Why the last held save failed, shown beside Save until the next one. */
  const [failure, setFailure] = useState<string | null>(null);
  const isSavingStatus = saving !== null;
  const isRecurring = task.seriesMasterId !== null;
  // Shared with iOS, so both compare edits against the same pattern.
  const resolvedRecurrence = useMemo(
    () => resolveTaskRecurrenceForEditor(task, tasksQuery.data ?? []),
    [task, tasksQuery.data]
  );

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const confirmDelete = useCallback(
    (scope: DeleteScope) => {
      onClose();
      deleteTask.mutate({ id: task.id, scope });
    },
    [deleteTask, onClose, task]
  );

  // Delete hotkey - only active when popover is open, skips text inputs
  // Uses "backspace" for Mac compatibility (Mac's delete key = backspace)
  useHotkeys(
    "backspace, delete",
    (e) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"
      ) {
        return;
      }
      e.preventDefault();
      handleDeleteClick();
    },
    // Not behind a dialog over the editor, where it would delete the task
    // out from under the question being asked.
    {
      enabled:
        open && !isSavingStatus && !showTagScopeDialog && !showDeleteConfirm,
    },
    [
      handleDeleteClick,
      isSavingStatus,
      open,
      showDeleteConfirm,
      showTagScopeDialog,
    ]
  );

  const form = useForm<TaskFormValues>({
    defaultValues: buildTaskEditValues(task, resolvedRecurrence),
  });
  const {
    control,
    setValue,
    handleSubmit,
    getValues,
    formState: { isDirty },
  } = form;

  useSyncedSchedule(task, setValue);

  const startDate = useWatch({ control, name: "startDate" });
  const recurrence = useWatch({ control, name: "recurrence" });
  // The note under Repeat says why; Save and Mark done wait for a fix.
  const repeatBlocked = repeatBlocksSave({
    next: recurrence,
    previous: resolvedRecurrence,
    startDate,
  });

  /**
   * Saves the edits, plus `extra` fields. Resolves to whether it saved; a
   * failure is reported by the mutation.
   */
  const commitUpdate = useCallback(
    (
      values: TaskFormValues,
      scope: UpdateScope,
      extra: Partial<TaskUpdateDecoded> = {},
      /**
       * While the editor holds open on the save: optimistic
       * false, and a failure message that says the edits are still here.
       */
      held?: { failureMessage: string }
    ): Promise<boolean> => {
      if (held) {
        setFailure(null);
      }
      const normalizedDuration =
        Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
          ? Math.round(values.durationMinutes)
          : (task.durationMinutes ?? 30);

      return updateTask
        .mutateAsync({
          failureMessage: held?.failureMessage,
          id: task.id,
          optimistic: !held,
          // The held editor says what failed, beside Save.
          quiet: Boolean(held),
          scope,
          task: {
            description: values.description ?? "",
            dueDate: values.dueDate,
            durationMinutes: normalizedDuration,
            links: values.links,
            // Sent only when it changed: an explicit null ends the repeat,
            // so an untouched occurrence must not send one.
            recurrence: taskRecurrenceEquals(
              resolvedRecurrence,
              values.recurrence
            )
              ? undefined
              : values.recurrence,
            startDate: values.startDate,
            startTime: values.startTime,
            tagIds: values.tagIds,
            title: values.title.trim(),
            ...extra,
          },
        })
        .then(
          () => true,
          () => {
            setFailure(held?.failureMessage ?? null);
            return false;
          }
        );
    },
    [resolvedRecurrence, task, updateTask]
  );

  /**
   * Saves the scope dialog's edits, then marks this occurrence done when
   * Mark done asked for it.
   */
  const commitWithStatus = useCallback(
    (
      values: TaskFormValues,
      scope: UpdateScope,
      status: TaskSelectDecoded["status"] | null
    ): Promise<boolean> => {
      if (!status) {
        return commitUpdate(values, scope);
      }
      // One write: the status goes on this occurrence alone (the server
      // keeps it when a "following" save also changes the series). The
      // editor holds open until it saves, so the cache waits for the server:
      // an early update could unmount the editor or roll back over the draft.
      return commitUpdate(
        values,
        scope,
        { status },
        { failureMessage: markStatusFailureMessage(status) }
      );
    },
    [commitUpdate]
  );

  /** Whether saving `values` needs the scope dialog, or which scope it uses. */
  const scopeDecisionFor = useCallback(
    (values: TaskFormValues) =>
      getTaskUpdateScopeDecision({
        hasCoreFieldChanges: haveTaskCoreFieldsChanged({
          next: {
            description: values.description,
            dueDate: values.dueDate,
            durationMinutes: values.durationMinutes,
            startDate: values.startDate,
            startTime: values.startTime,
            title: values.title,
          },
          previous: {
            description: task.description,
            dueDate: task.dueDate,
            durationMinutes: task.durationMinutes,
            startDate: task.startDate,
            startTime: task.startTime,
            title: task.title,
          },
        }),
        // Moving it to the inbox (no date) changes it alone.
        hasFollowing: hasFollowing(task) && values.startDate !== null,
        isRecurring,
        nextRecurrence: values.recurrence,
        nextTagIds: values.tagIds,
        previousRecurrence: resolvedRecurrence,
        previousTagIds: task.tags.map((tag) => tag.id),
      }),
    [isRecurring, resolvedRecurrence, task]
  );

  /** Saves, through the scope question for a series; the editor holds open meanwhile. */
  const submit = useCallback(
    (values: TaskFormValues) => {
      // The note under Repeat says why ("The repeat ends Nov 10, before...").
      if (
        repeatBlocksSave({
          next: values.recurrence,
          previous: resolvedRecurrence,
          startDate: values.startDate,
        })
      ) {
        return;
      }
      const decision = scopeDecisionFor(values);
      if (decision.action === "prompt") {
        pendingUpdateRef.current = values;
        askScope(decision.defaultScope);
        return;
      }

      // The editor holds open ("Saving…") until the save succeeds, so a
      // failed save keeps the edits.
      holdOpen(
        "save",
        commitUpdate(
          values,
          decision.scope,
          {},
          { failureMessage: SAVE_FAILURE_MESSAGE }
        )
      );
    },
    [askScope, commitUpdate, holdOpen, resolvedRecurrence, scopeDecisionFor]
  );

  // Mark done saves unsaved edits with it, so they're never dropped: in one
  // save where it can, through the scope dialog when
  // the task repeats. With edits, the editor stays open until they've
  // saved, so a failed save keeps them.
  const handleToggleDone = useCallback(() => {
    const status = task.status === "done" ? "todo" : "done";
    const values = getValues();
    const decision = isDirty ? scopeDecisionFor(values) : null;
    if (!decision) {
      updateTask.mutate({ id: task.id, scope: "this", task: { status } });
      onClose();
      return;
    }
    if (decision.action === "prompt") {
      pendingUpdateRef.current = values;
      pendingStatusRef.current = status;
      askScope(decision.defaultScope);
      return;
    }
    holdOpen("done", commitWithStatus(values, decision.scope, status));
  }, [
    commitWithStatus,
    getValues,
    holdOpen,
    isDirty,
    onClose,
    scopeDecisionFor,
    task,
    updateTask,
    askScope,
  ]);

  const handleSaveClick = useCallback(
    () => submit(getValues()),
    [getValues, submit]
  );

  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSaveClick();
    },
    {
      enabled: canSaveFromKeyboard({
        dialogOpen: showTagScopeDialog || showDeleteConfirm,
        open,
        saving: isSavingStatus,
      }),
      enableOnFormTags: true,
    },
    [
      handleSaveClick,
      isSavingStatus,
      open,
      showDeleteConfirm,
      showTagScopeDialog,
    ]
  );

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
      {/* While a save runs, the fields are read-only too: a change typed
          then would be dropped when the editor closes. (A block, not
          display: contents, so the form's spacing still reaches the fields.) */}
      <HeldFieldset className="min-w-0 space-y-3" saving={isSavingStatus}>
        <TaskFields
          form={form}
          isRecurring={isRecurring}
          previousRecurrence={resolvedRecurrence}
          undatedMember={isUndatedMember(task)}
        />

        <SaveFailure message={failure} />
        <Separator />
        {/* Wraps when a done task's longer "Mark not done" doesn't fit. */}
        <div className="flex flex-wrap items-center gap-2">
          <AlertDialog
            onOpenChange={setShowDeleteConfirm}
            open={showDeleteConfirm}
          >
            <AlertDialogTrigger asChild>
              <Button
                className="gap-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                disabled={isSavingStatus}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete task?</AlertDialogTitle>
                <AlertDialogDescription>
                  {hasFollowing(task)
                    ? SCOPE_DIALOG_COPY.deleteTask.description
                    : SCOPE_DIALOG_COPY.deleteTaskAlone.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter
                className={
                  hasFollowing(task) ? "flex-col gap-2 sm:flex-col" : ""
                }
              >
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                {hasFollowing(task) ? (
                  <>
                    <AlertDialogAction onClick={() => confirmDelete("this")}>
                      Only this occurrence
                    </AlertDialogAction>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => confirmDelete("following")}
                    >
                      This and following
                    </AlertDialogAction>
                  </>
                ) : (
                  <AlertDialogAction onClick={() => confirmDelete("this")}>
                    Delete
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <TaskDoneButton
            disabled={isDoneBlocked(saving, repeatBlocked)}
            isDone={task.status === "done"}
            isSaving={saving === "done"}
            onClick={handleToggleDone}
          />
          <TaskEditorCloseActions
            onCancel={onClose}
            onSave={handleSaveClick}
            saveBlocked={repeatBlocked}
            saving={saving}
          />
        </div>

        <RecurrenceScopeDialog
          confirmLabel="Apply"
          description={SCOPE_DIALOG_COPY.saveTask.description}
          // The dialog has no trigger to return focus to, so it would fall
          // to the page, where the calendar's keys could navigate away. On
          // Cancel it goes back where the user was. Apply starts a held
          // save, which remounts the fields and this dialog with them
          // (HeldFieldset), so that field is gone and focus goes to the
          // editor. Once the editor has closed, it stays where that put it.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const editor = hold.editorRef.current;
            const before = focusBeforeScopeRef.current;
            if (before?.isConnected && editor?.contains(before)) {
              before.focus();
              return;
            }
            editor?.focus();
          }}
          onConfirm={() => {
            const pendingUpdate = pendingUpdateRef.current;
            if (!pendingUpdate) {
              return;
            }
            const status = pendingStatusRef.current;
            pendingUpdateRef.current = null;
            pendingStatusRef.current = null;
            if (!status) {
              holdOpen(
                "save",
                commitUpdate(
                  pendingUpdate,
                  tagScope,
                  {},
                  { failureMessage: SAVE_FAILURE_MESSAGE }
                )
              );
              return;
            }
            // With Mark done, the editor stays open ("Saving…") until the
            // save succeeds, so a failed save keeps the edits.
            holdOpen("done", commitWithStatus(pendingUpdate, tagScope, status));
          }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              pendingUpdateRef.current = null;
              pendingStatusRef.current = null;
            }
            setShowTagScopeDialog(nextOpen);
          }}
          onValueChange={(value) => setTagScope(value as UpdateScope)}
          open={showTagScopeDialog}
          options={TASK_UPDATE_SCOPE_OPTIONS}
          title={SCOPE_DIALOG_COPY.saveTask.title}
          value={tagScope}
        />
      </HeldFieldset>
    </form>
  );
}

/**
 * The task side of the create popover, which owns Save and holds while the
 * create runs (its fieldset disables these fields meanwhile).
 */
export function TaskCreateForm({
  createInteropRef,
  initialValues,
  saving,
  submitRef,
}: {
  createInteropRef: React.Ref<CalendarCreateFormInterop>;
  initialValues: Partial<TaskFormValues>;
  /** The create popover holds for the create (see useHeldSave). */
  saving: boolean;
  /** True when there's nothing to create, false when the repeat blocks it, or the create to wait for. */
  submitRef: React.Ref<() => boolean | Promise<boolean>>;
}) {
  const { createTask } = useTasks();
  const form = useForm<TaskFormValues>({
    defaultValues: buildTaskCreateValues(initialValues),
  });
  const { getValues, handleSubmit, setValue } = form;
  const previousRecurrence = initialValues.recurrence ?? null;

  const submit = useCallback(
    (values: TaskFormValues): boolean | Promise<boolean> => {
      // The note under Repeat says why ("The repeat ends Nov 10, before...").
      if (
        repeatBlocksSave({
          next: values.recurrence,
          previous: previousRecurrence,
          startDate: values.startDate,
        })
      ) {
        return false;
      }
      const payload = buildTaskCreatePayload(values);
      if (!payload) {
        return true;
      }
      return createTask
        .mutateAsync({
          ...payload,
          failureMessage: TASK_CREATE_FAILURE_MESSAGE,
          // The create popover shows a failure beside its own Save.
          quiet: true,
        })
        .then(
          () => true,
          () => false
        );
    },
    [createTask, previousRecurrence]
  );

  useImperativeHandle(submitRef, () => () => submit(getValues()), [
    getValues,
    submit,
  ]);

  const applySharedFields = useCallback(
    (fields: CalendarCreateSharedFields) => {
      setValue("title", fields.title, { shouldDirty: true });
      setValue("description", fields.description, { shouldDirty: true });
      setValue(
        "startDate",
        fields.startDate ? pickerDateToTemporal(fields.startDate) : null,
        { shouldDirty: true }
      );
      setValue(
        "startTime",
        fields.startTime ? Temporal.PlainTime.from(fields.startTime) : null,
        { shouldDirty: true }
      );
      setValue(
        "durationMinutes",
        Math.max(5, Math.round(fields.durationMinutes)),
        {
          shouldDirty: true,
        }
      );
      setValue("dueDate", null, { shouldDirty: true });
      setValue("links", [], { shouldDirty: true });
      setValue("tagIds", [], { shouldDirty: true });
      setValue("recurrence", null, { shouldDirty: true });
    },
    [setValue]
  );

  const getSharedFields = useCallback(
    () => getSharedFieldsFromTaskValues(getValues()),
    [getValues]
  );

  useImperativeHandle(
    createInteropRef,
    () => ({ applySharedFields, getSharedFields }),
    [applySharedFields, getSharedFields]
  );

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
      {/* Remounts read-only while the create runs, closing an open picker
          (its options are portaled outside the popover's fieldset). */}
      <HeldFieldset className="min-w-0 space-y-3" saving={saving}>
        <TaskFields
          form={form}
          isRecurring={false}
          previousRecurrence={previousRecurrence}
          undatedMember={false}
        />
      </HeldFieldset>
    </form>
  );
}

/** The task's fields, shared by the editor and the create popover. */
function TaskFields({
  form: { control, getValues, setValue },
  isRecurring,
  previousRecurrence,
  undatedMember,
}: {
  form: UseFormReturn<TaskFormValues>;
  /** Whether the task is in a series, for the note under Repeat. */
  isRecurring: boolean;
  /** The repeat the task had when the form opened. */
  previousRecurrence: TaskRecurrence | null;
  /** A series occurrence with no date (see isUndatedMember). */
  undatedMember: boolean;
}) {
  const { parseLink } = useTasks();
  const watchedValues = useWatch({ control });
  // Separate watch for startDate to preserve Temporal.PlainDate type (useWatch returns deeply partial)
  const startDate = useWatch({ control, name: "startDate" });
  // Separate watch for links to preserve array type
  const links = useWatch({ control, name: "links" }) as LinkMeta[];
  const recurrence = useWatch({ control, name: "recurrence" });

  return (
    <>
      <Input
        onChange={(e) =>
          setValue("title", e.target.value, { shouldDirty: true })
        }
        placeholder="Task title"
        value={watchedValues.title}
      />

      <Textarea
        onChange={(e) =>
          setValue("description", e.target.value, { shouldDirty: true })
        }
        placeholder="Add details..."
        value={watchedValues.description}
      />

      <Separator />

      {/* Row 1: Start date, time, duration (calendar scheduling) */}
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
        <Controller
          control={control}
          name="startDate"
          render={({ field }) => (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  className={cn(
                    "justify-start gap-2 text-left font-medium text-xs",
                    !field.value && "text-muted-foreground"
                  )}
                  variant="outline"
                >
                  <CalendarClock className="size-4 shrink-0" />
                  <span className="truncate">
                    {field.value
                      ? `Start: ${formatPlainDate(field.value, {
                          day: "numeric",
                          month: "short",
                        })}`
                      : "Schedule"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="single"
                  onSelect={(date) =>
                    field.onChange(date ? pickerDateToTemporal(date) : null)
                  }
                  selected={
                    field.value ? temporalToPickerDate(field.value) : undefined
                  }
                />
                {field.value && (
                  <div className="border-t p-2">
                    <Button
                      className="w-full gap-2 hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        field.onChange(null);
                        setValue("startTime", null, { shouldDirty: true });
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <X className="size-4" />
                      Clear date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
        />

        <Controller
          control={control}
          name="startTime"
          render={({ field }) => {
            const value = field.value
              ? `${String(field.value.hour).padStart(2, "0")}:${String(
                  field.value.minute
                ).padStart(2, "0")}`
              : "";

            return (
              <TimePicker
                onChange={(nextValue) => {
                  const [hours, minutes] = nextValue.split(":").map(Number);
                  field.onChange(
                    Temporal.PlainTime.from({ hour: hours, minute: minutes })
                  );
                }}
                placeholder="Time"
                value={value}
              />
            );
          }}
        />

        <Controller
          control={control}
          name="durationMinutes"
          render={({ field }) => (
            <DurationPicker
              onChange={(minutes) => field.onChange(minutes)}
              value={field.value}
            />
          )}
        />
      </div>

      {/* Row 2: Due date and Recurrence */}
      <div className="grid grid-cols-2 gap-2">
        <Controller
          control={control}
          name="dueDate"
          render={({ field }) => (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  className={cn(
                    "justify-start gap-2 text-left font-medium text-xs",
                    !field.value && "text-muted-foreground"
                  )}
                  variant="outline"
                >
                  <CalendarCheck className="size-4 shrink-0" />
                  {field.value
                    ? `Due: ${formatPlainDate(field.value, {
                        day: "numeric",
                        month: "short",
                      })}`
                    : "Due date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="single"
                  onSelect={(date) =>
                    field.onChange(date ? pickerDateToTemporal(date) : null)
                  }
                  selected={
                    field.value === undefined || field.value === null
                      ? undefined
                      : temporalToPickerDate(field.value)
                  }
                />
                {field.value && (
                  <div className="border-t p-2">
                    <Button
                      className="w-full gap-2 hover:bg-accent hover:text-accent-foreground"
                      onClick={() => field.onChange(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <X className="size-4" />
                      Clear date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
        />

        <Controller
          control={control}
          name="recurrence"
          render={({ field }) => (
            <RecurrenceEditor
              onChange={field.onChange}
              referenceDate={startDate}
              value={field.value}
            />
          )}
        />
      </div>
      <RepeatNote
        note={repeatNote({
          isRecurring,
          next: recurrence,
          previous: previousRecurrence,
          startDate,
          undatedMember,
        })}
      />

      <Separator />

      <LinkListEditor
        isParsing={parseLink.isPending}
        links={links}
        onAddLink={(url) => {
          // Insert an unknown placeholder immediately so the link
          // is persisted even if the user saves before parse completes.
          const placeholder: LinkMeta = {
            fetchedAt: new Date().toISOString(),
            provider: "unknown",
            url,
          };
          const currentLinks =
            (getValues("links") as unknown as LinkMeta[]) ?? [];
          const isFirstLink = currentLinks.length === 0;
          setValue("links", dedupeLinks([...currentLinks, placeholder]), {
            shouldDirty: true,
          });

          parseLink.mutate(url, {
            onSuccess: (meta) => {
              const latest =
                (getValues("links") as unknown as LinkMeta[]) ?? [];
              setValue(
                "links",
                dedupeLinks(latest.map((l) => (l.url === url ? meta : l))),
                { shouldDirty: true }
              );

              if (isFirstLink) {
                if (meta.title && !getValues("title")?.trim()) {
                  setValue("title", meta.title, { shouldDirty: true });
                }
                if ("durationSeconds" in meta && meta.durationSeconds > 0) {
                  setValue(
                    "durationMinutes",
                    Math.ceil(meta.durationSeconds / 60),
                    { shouldDirty: true }
                  );
                }
              }
            },
          });
        }}
        onRemoveLink={(index) => {
          setValue(
            "links",
            links.filter((_, i) => i !== index),
            { shouldDirty: true }
          );
        }}
      />

      <Controller
        control={control}
        name="tagIds"
        render={({ field }) => (
          <TagPicker onChange={field.onChange} value={field.value ?? []} />
        )}
      />
    </>
  );
}

function LinkMetaPreview({
  meta,
  onRemove,
}: {
  meta: LinkMeta;
  onRemove?: () => void;
}) {
  const label = getProviderLabel(meta.provider);
  const durationMinutes = getLinkDurationMinutes(meta);
  const wordCount = getLinkWordCount(meta);

  return (
    <div className="group flex items-start gap-2 rounded-md border bg-muted/50 p-2">
      {meta.thumbnailUrl && (
        <Image
          alt={meta.title ?? "Link thumbnail"}
          className="size-10 shrink-0 rounded object-cover"
          height={40}
          src={meta.thumbnailUrl}
          unoptimized
          width={40}
        />
      )}
      <button
        className="min-w-0 flex-1 cursor-pointer space-y-0.5 text-left"
        onClick={() => window.open(meta.url, "_blank", "noopener,noreferrer")}
        type="button"
      >
        <p className="truncate font-medium text-xs">
          {meta.title ?? "Untitled"}
        </p>
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span>{label}</span>
          {durationMinutes !== null && <span>{durationMinutes}m</span>}
          {wordCount !== null && (
            <span>{wordCount.toLocaleString()} words</span>
          )}
        </div>
      </button>
      {onRemove && (
        <button
          aria-label={`Remove ${meta.title ?? "link"}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onRemove}
          type="button"
        >
          <XCircle className="size-4" />
        </button>
      )}
    </div>
  );
}

function LinkListEditor({
  links,
  isParsing,
  onAddLink,
  onRemoveLink,
}: {
  isParsing: boolean;
  links: LinkMeta[];
  onAddLink: (url: string) => void;
  onRemoveLink: (index: number) => void;
}) {
  const [linkInput, setLinkInput] = useState("");

  const submitUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    if (!URL_REGEX.test(trimmed)) {
      return;
    }
    if (links.some((l) => l.url === trimmed)) {
      setLinkInput("");
      return;
    }
    onAddLink(trimmed);
    setLinkInput("");
  };

  return (
    <div className="space-y-2">
      <Label className="font-medium text-muted-foreground text-xs">Links</Label>

      {links.map((meta, index) => (
        <LinkMetaPreview
          key={meta.url}
          meta={meta}
          onRemove={() => onRemoveLink(index)}
        />
      ))}

      <div className="relative">
        <span
          aria-hidden
          className="absolute top-1/2 left-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground"
        >
          <Link2 className="size-4" />
        </span>
        <Input
          className="pl-8"
          onBlur={() => submitUrl(linkInput)}
          onChange={(e) => setLinkInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitUrl(linkInput);
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text/plain").trim();
            if (pasted && URL_REGEX.test(pasted)) {
              e.preventDefault();
              submitUrl(pasted);
            }
          }}
          placeholder="https://..."
          type="url"
          value={linkInput}
        />
        {isParsing && (
          <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
