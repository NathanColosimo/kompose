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
  resolveTaskRecurrenceForEditor,
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
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const triggerRef = useRef<HTMLElement | null>(null);
  // Radix types the trigger as a button; the child here can be any element.
  const setTrigger = useCallback((element: HTMLElement | null) => {
    triggerRef.current = element;
  }, []);
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      // Focus moves into the editor, so Tab reaches its fields, but not to
      // the title: there Backspace would edit it instead of deleting the task.
      event.preventDefault();
      contentRef.current?.focus();
      if (!(matchesOpenRequest && openRequest)) {
        return;
      }
      // Opened from search, the task can be scrolled out of its list or
      // the calendar's hours; the editor follows it, so bring it into view.
      triggerRef.current?.scrollIntoView({
        block: "center",
        inline: "nearest",
      });

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
      <PopoverTrigger asChild ref={setTrigger}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="max-h-(--radix-popover-content-available-height) w-[360px] max-w-[calc(100vw-16px)] space-y-3 overflow-y-auto p-4"
        collisionPadding={8}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onOpenAutoFocus={handleOpenAutoFocus}
        ref={contentRef}
        // A phone has no room beside the task, and Radix only slides a side
        // placement up or down, so the editor opens below it instead.
        side={isNarrow ? "bottom" : side}
      >
        <TaskEditForm
          editorRef={contentRef}
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

/** Cancel and Save. */
function TaskEditorCloseActions({
  onCancel,
  onSave,
  saveBlocked,
}: {
  onCancel: () => void;
  onSave: () => void;
  /** The form can't be saved as is; the form says why. */
  saveBlocked: boolean;
}) {
  return (
    <div className="ml-auto flex gap-2">
      <Button onClick={onCancel} size="sm" type="button" variant="ghost">
        Cancel
      </Button>
      <Button disabled={saveBlocked} onClick={onSave} size="sm" type="button">
        Save
      </Button>
    </div>
  );
}

/** Done / Not done; narrow calendar blocks hide their checkbox, so it's here too. */
function TaskDoneButton({
  disabled,
  isDone,
  onClick,
}: {
  /** The repeat can't save. */
  disabled: boolean;
  isDone: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      disabled={disabled}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {isDone ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
      {isDone ? "Mark not done" : "Mark done"}
    </Button>
  );
}

/** Edits a task: Save, Mark done and Delete, with the scope question for a series. */
function TaskEditForm({
  editorRef,
  task,
  onClose,
  open,
}: {
  task: TaskSelectDecoded;
  onClose: () => void;
  editorRef: RefObject<HTMLDivElement | null>;
  open: boolean;
}) {
  const { updateTask, deleteTask, tasksQuery } = useTasks();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTagScopeDialog, setShowTagScopeDialog] = useState(false);
  const [tagScope, setTagScope] = useState<UpdateScope>("this");
  const pendingUpdateRef = useRef<TaskFormValues | null>(null);
  /** Mark done waiting on the scope dialog for the edits saved with it. */
  const pendingStatusRef = useRef<"done" | "todo" | null>(null);
  const askScope = useCallback((defaultScope: UpdateScope) => {
    setTagScope(defaultScope);
    setShowTagScopeDialog(true);
  }, []);
  const isRecurring = task.seriesMasterId !== null;
  // Shared with iOS, so both compare edits against the same pattern.
  const resolvedRecurrence = useMemo(
    () => resolveTaskRecurrenceForEditor(task, tasksQuery.data ?? []),
    [task, tasksQuery.data]
  );

  /** The delete question came from Backspace, not from the trash icon. */
  const deleteFromKeyRef = useRef(false);

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
      deleteFromKeyRef.current = true;
      setShowDeleteConfirm(true);
    },
    // Not behind a dialog over the editor, where it would delete the task
    // out from under the question being asked.
    {
      enabled: open && !showTagScopeDialog && !showDeleteConfirm,
    },
    [open, showDeleteConfirm, showTagScopeDialog]
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
  const repeatBlocked = Boolean(recurrence && !startDate);

  /** Save the edits, plus any status change, and close immediately. */
  const commitUpdate = useCallback(
    (
      values: TaskFormValues,
      scope: UpdateScope,
      extra: Partial<TaskUpdateDecoded> = {}
    ) => {
      const normalizedDuration =
        Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
          ? Math.round(values.durationMinutes)
          : (task.durationMinutes ?? 30);

      updateTask.mutate({
        id: task.id,
        scope,
        task: {
          description: values.description ?? "",
          dueDate: values.dueDate,
          durationMinutes: normalizedDuration,
          links: values.links,
          recurrence: values.recurrence,
          startDate: values.startDate,
          startTime: values.startTime,
          tagIds: values.tagIds,
          title: values.title.trim(),
          ...extra,
        },
      });
      onClose();
    },
    [onClose, task, updateTask]
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
        isRecurring,
        isSeriesMaster: task.seriesMasterId === task.id,
        nextRecurrence: values.recurrence,
        nextTagIds: values.tagIds,
        previousRecurrence: resolvedRecurrence,
        previousTagIds: task.tags.map((tag) => tag.id),
      }),
    [isRecurring, resolvedRecurrence, task]
  );

  /** Save through the scope question when the task repeats. */
  const submit = useCallback(
    (values: TaskFormValues) => {
      if (values.recurrence && !values.startDate) {
        return;
      }
      const decision = scopeDecisionFor(values);
      if (decision.action === "prompt") {
        pendingUpdateRef.current = values;
        askScope(decision.defaultScope);
        return;
      }

      commitUpdate(values, decision.scope);
    },
    [askScope, commitUpdate, scopeDecisionFor]
  );

  // Mark done saves unsaved edits with it, so they're never dropped: in one
  // save where it can, through the scope dialog when the task repeats.
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
    commitUpdate(values, decision.scope, { status });
  }, [
    commitUpdate,
    getValues,
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
    // Not behind a dialog over the editor, where it would re-ask and drop
    // the choice made in it.
    {
      enabled: open && !showTagScopeDialog && !showDeleteConfirm,
      enableOnFormTags: true,
    },
    [handleSaveClick, open, showDeleteConfirm, showTagScopeDialog]
  );

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
      <TaskFields form={form} />

      <Separator />
      {/* Wraps rather than clipping Save if the labels grow (larger text). */}
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog
          onOpenChange={setShowDeleteConfirm}
          open={showDeleteConfirm}
        >
          {/* An icon, so Delete, Mark done, Cancel and Save fit one row
                in the 360px editor. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button
                  aria-label="Delete task"
                  className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <AlertDialogContent
            // Opened with Backspace, focus goes back to the editor it came
            // from. (Radix would send it to the trash icon, whose tooltip
            // would then take the next Escape.) Opened from the icon, it
            // returns to the icon, as a dialog should.
            onCloseAutoFocus={(e) => {
              if (!deleteFromKeyRef.current) {
                return;
              }
              e.preventDefault();
              deleteFromKeyRef.current = false;
              editorRef.current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete task?</AlertDialogTitle>
              <AlertDialogDescription>
                {isRecurring
                  ? SCOPE_DIALOG_COPY.deleteTask.description
                  : SCOPE_DIALOG_COPY.deleteTaskAlone.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter
              className={isRecurring ? "flex-col gap-2 sm:flex-col" : ""}
            >
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {isRecurring ? (
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
          disabled={repeatBlocked}
          isDone={task.status === "done"}
          onClick={handleToggleDone}
        />
        <TaskEditorCloseActions
          onCancel={onClose}
          onSave={handleSaveClick}
          saveBlocked={repeatBlocked}
        />
      </div>

      <RecurrenceScopeDialog
        confirmLabel="Apply"
        description={SCOPE_DIALOG_COPY.saveTask.description}
        onConfirm={() => {
          const pendingUpdate = pendingUpdateRef.current;
          if (!pendingUpdate) {
            return;
          }
          const status = pendingStatusRef.current;
          pendingUpdateRef.current = null;
          pendingStatusRef.current = null;
          commitUpdate(pendingUpdate, tagScope, status ? { status } : {});
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
    </form>
  );
}

/** The task side of the create popover. */
export function TaskCreateForm({
  createInteropRef,
  initialValues,
  submitRef,
}: {
  createInteropRef: React.Ref<CalendarCreateFormInterop>;
  initialValues: Partial<TaskFormValues>;
  /** Whether the create popover may close after submitting. */
  submitRef: React.Ref<() => boolean>;
}) {
  const { createTask } = useTasks();
  const form = useForm<TaskFormValues>({
    defaultValues: buildTaskCreateValues(initialValues),
  });
  const { getValues, handleSubmit, setValue } = form;

  const submit = useCallback(
    (values: TaskFormValues): boolean => {
      if (values.recurrence && !values.startDate) {
        return false;
      }
      const payload = buildTaskCreatePayload(values);
      if (!payload) {
        return true;
      }
      createTask.mutate(payload);
      return true;
    },
    [createTask]
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
      <TaskFields form={form} />
    </form>
  );
}

/** The task's fields, shared by the editor and the create popover. */
function TaskFields({
  form: { control, getValues, setValue },
}: {
  form: UseFormReturn<TaskFormValues>;
}) {
  const { parseLink } = useTasks();
  const watchedValues = useWatch({ control });
  // Separate watch for startDate to preserve Temporal.PlainDate type (useWatch returns deeply partial)
  const startDate = useWatch({ control, name: "startDate" });
  // Separate watch for links to preserve array type
  const links = useWatch({ control, name: "links" });
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
                  onSelect={(date) => {
                    const start = date ? pickerDateToTemporal(date) : null;
                    field.onChange(start);
                    if (!start) {
                      setValue("startTime", null, { shouldDirty: true });
                    }
                    const repeat = getValues("recurrence");
                    if (
                      start &&
                      repeat?.until &&
                      Temporal.PlainDate.compare(
                        start,
                        Temporal.PlainDate.from(repeat.until)
                      ) > 0
                    ) {
                      setValue(
                        "recurrence",
                        { ...repeat, until: start.toString() },
                        { shouldDirty: true }
                      );
                    }
                  }}
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
      {recurrence && !startDate ? (
        <p className="text-destructive text-xs">
          Pick a start date to repeat this task.
        </p>
      ) : null}

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
          const currentLinks = getValues("links") ?? [];
          const isFirstLink = currentLinks.length === 0;
          setValue("links", dedupeLinks([...currentLinks, placeholder]), {
            shouldDirty: true,
          });

          parseLink.mutate(url, {
            onSuccess: (meta) => {
              const latest = getValues("links") ?? [];
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
