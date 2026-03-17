"use client";

import type {
  ClientTaskInsertDecoded,
  DeleteScope,
  LinkMeta,
  TaskRecurrence,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { focusedTaskIdAtom } from "@kompose/state/atoms/command-bar";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  dedupeLinks,
  getLinkDurationMinutes,
  getLinkWordCount,
  getProviderLabel,
  URL_REGEX,
} from "@kompose/state/link-meta-utils";
import { TASK_UPDATE_SCOPE_OPTIONS } from "@kompose/state/recurrence-scope-options";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
} from "@kompose/state/task-recurrence";
import { useAtom } from "jotai";
import {
  CalendarCheck,
  CalendarClock,
  Clock3,
  Link2,
  Loader2,
  Timer,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import type {
  CalendarCreateFormInterop,
  CalendarCreateSharedFields,
} from "../calendar/event-creation/create-form-shared";
import { Label } from "../ui/label";
import { RecurrenceEditor } from "./recurrence-editor";

/** Form state uses Temporal types, convert to native Date only at picker boundary */
export interface TaskFormValues {
  description: string;
  /** Due date - when task is due */
  dueDate: Temporal.PlainDate | null;
  durationMinutes: number;
  /** Array of parsed link metadata objects */
  links: LinkMeta[];
  /** Recurrence pattern (null = non-recurring) */
  recurrence: TaskRecurrence | null;
  /** Start date - when task appears in inbox or on calendar */
  startDate: Temporal.PlainDate | null;
  /** Start time - time of day for calendar scheduling (independent of startDate) */
  startTime: Temporal.PlainTime | null;
  tagIds: string[];
  title: string;
}

interface TaskEditPopoverProps {
  align?: "start" | "center" | "end";
  children: ReactElement;
  initialValues?: Partial<TaskFormValues>;
  mode?: "create" | "edit";
  side?: "top" | "right" | "bottom" | "left";
  task?: TaskSelectDecoded;
}

const EMPTY_TASK_FORM_VALUES: TaskFormValues = {
  title: "",
  description: "",
  tagIds: [],
  startDate: null,
  startTime: null,
  dueDate: null,
  durationMinutes: 30,
  links: [],
  recurrence: null,
};

function buildTaskInitialValues({
  task,
  initialValues,
  resolvedRecurrence,
}: {
  task?: TaskSelectDecoded;
  initialValues?: Partial<TaskFormValues>;
  resolvedRecurrence?: TaskRecurrence | null;
}): TaskFormValues {
  if (!task) {
    const initialDuration = initialValues?.durationMinutes;
    return {
      ...EMPTY_TASK_FORM_VALUES,
      ...initialValues,
      durationMinutes:
        typeof initialDuration === "number" && initialDuration > 0
          ? Math.round(initialDuration)
          : EMPTY_TASK_FORM_VALUES.durationMinutes,
    };
  }

  return {
    title: task.title ?? "",
    description: task.description ?? "",
    tagIds: task.tags.map((tag) => tag.id),
    startDate: task.startDate ?? null,
    startTime: task.startTime ?? null,
    dueDate: task.dueDate ?? null,
    durationMinutes: task.durationMinutes ?? 30,
    links: task.links ?? [],
    recurrence: resolvedRecurrence ?? null,
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
    title,
    description: values.description.trim() ? values.description.trim() : null,
    tagIds: values.tagIds,
    startDate: values.startDate,
    startTime: values.startTime,
    dueDate: values.dueDate,
    durationMinutes:
      Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
        ? Math.round(values.durationMinutes)
        : 30,
    links: values.links,
    recurrence: values.recurrence,
    status: "todo",
    seriesMasterId: null,
    isException: false,
  };
}

function getSharedFieldsFromTaskValues(
  values: TaskFormValues
): CalendarCreateSharedFields {
  return {
    title: values.title,
    description: values.description,
    startDate: values.startDate ? temporalToPickerDate(values.startDate) : null,
    startTime: values.startTime
      ? `${String(values.startTime.hour).padStart(2, "0")}:${String(
          values.startTime.minute
        ).padStart(2, "0")}`
      : "",
    durationMinutes:
      Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
        ? Math.round(values.durationMinutes)
        : 30,
  };
}

/**
 * Shared popover for inline task editing (title, description, start date/time, duration).
 */
export function TaskEditPopover({
  task,
  children,
  initialValues,
  mode: modeProp,
  side = "right",
  align = "start",
}: TaskEditPopoverProps) {
  const mode = modeProp ?? (task ? "edit" : "create");
  const [open, setOpen] = useState(false);
  const [focusedTaskId, setFocusedTaskId] = useAtom(focusedTaskIdAtom);

  // Open popover when this task is focused via command bar search
  useEffect(() => {
    if (mode === "edit" && task && focusedTaskId === task.id) {
      setOpen(true);
      setFocusedTaskId(null);
    }
  }, [focusedTaskId, mode, setFocusedTaskId, task]);

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[360px] space-y-3 p-4"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        side={side}
      >
        <TaskEditForm
          initialValues={initialValues}
          key={task?.id ?? "create-task"}
          mode={mode}
          onClose={handleCancel}
          open={open}
          task={task}
        />
      </PopoverContent>
    </Popover>
  );
}

export function TaskEditForm({
  task,
  initialValues: initialCreateValues,
  mode,
  onRegisterSubmit,
  onClose,
  open,
  onRegisterCreateInterop,
}: {
  task?: TaskSelectDecoded;
  initialValues?: Partial<TaskFormValues>;
  mode: "create" | "edit";
  /** When provided, the parent controls save (e.g. creation popover). Otherwise the form shows its own Save/Cancel buttons. */
  onRegisterSubmit?: (fn: () => boolean) => void;
  onClose: () => void;
  open: boolean;
  onRegisterCreateInterop?: (interop: CalendarCreateFormInterop | null) => void;
}) {
  const showActionButtons = !onRegisterSubmit;
  const { createTask, updateTask, deleteTask, tasksQuery, parseLink } =
    useTasks();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTagScopeDialog, setShowTagScopeDialog] = useState(false);
  const [tagScope, setTagScope] = useState<UpdateScope>("this");
  const [pendingUpdate, setPendingUpdate] = useState<TaskFormValues | null>(
    null
  );
  const isCreateMode = mode === "create";

  // Check if this task is part of a recurring series
  const isRecurring =
    !isCreateMode && task ? task.seriesMasterId !== null : false;
  const resolvedRecurrence = useMemo(() => {
    if (!task) {
      return initialCreateValues?.recurrence ?? null;
    }
    if (task.recurrence || !task.seriesMasterId) {
      return task.recurrence ?? null;
    }

    const masterTask = (tasksQuery.data ?? []).find(
      (candidate) => candidate.id === task.seriesMasterId
    );
    return masterTask?.recurrence ?? null;
  }, [initialCreateValues?.recurrence, task, tasksQuery.data]);

  // Opens confirmation dialog
  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  // Delete with specified scope
  const confirmDelete = useCallback(
    (scope: DeleteScope) => {
      if (!task) {
        return;
      }
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
      // Skip if focused on text input or textarea
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
    { enabled: open && !isCreateMode },
    [handleDeleteClick, isCreateMode, open]
  );

  const resolvedInitialValues = useMemo<TaskFormValues>(
    () =>
      buildTaskInitialValues({
        task,
        initialValues: initialCreateValues,
        resolvedRecurrence,
      }),
    [initialCreateValues, resolvedRecurrence, task]
  );

  const { control, reset, setValue, handleSubmit, getValues } =
    useForm<TaskFormValues>({
      defaultValues: resolvedInitialValues,
    });

  // Keep the form in sync if the task changes externally.
  useEffect(() => {
    reset(resolvedInitialValues, { keepDirty: false });
  }, [reset, resolvedInitialValues]);

  const watchedValues = useWatch({ control });
  // Separate watch for startDate to preserve Temporal.PlainDate type (useWatch returns deeply partial)
  const startDate = useWatch({ control, name: "startDate" });
  // Separate watch for links to preserve array type
  const links = useWatch({ control, name: "links" }) as LinkMeta[];

  const commitUpdate = useCallback(
    (values: TaskFormValues, scope: UpdateScope) => {
      if (!task) {
        return;
      }
      const normalizedDuration =
        Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
          ? Math.round(values.durationMinutes)
          : (task.durationMinutes ?? 30);

      updateTask.mutate({
        id: task.id,
        task: {
          title: values.title.trim(),
          description: values.description ?? "",
          tagIds: values.tagIds,
          startDate: values.startDate,
          startTime: values.startTime,
          dueDate: values.dueDate,
          durationMinutes: normalizedDuration,
          links: values.links,
          recurrence: values.recurrence,
        },
        scope,
      });
    },
    [task, updateTask]
  );

  const submit = useCallback(
    (values: TaskFormValues) => {
      if (isCreateMode) {
        const payload = buildTaskCreatePayload(values);
        if (!payload) {
          return true;
        }
        createTask.mutate(payload);
        return true;
      }

      if (!task) {
        return true;
      }

      const decision = getTaskUpdateScopeDecision({
        isRecurring,
        isSeriesMaster: task.seriesMasterId === task.id,
        hasCoreFieldChanges: haveTaskCoreFieldsChanged({
          previous: {
            title: task.title,
            description: task.description,
            durationMinutes: task.durationMinutes,
            dueDate: task.dueDate,
            startDate: task.startDate,
            startTime: task.startTime,
          },
          next: {
            title: values.title,
            description: values.description,
            durationMinutes: values.durationMinutes,
            dueDate: values.dueDate,
            startDate: values.startDate,
            startTime: values.startTime,
          },
        }),
        previousRecurrence: resolvedRecurrence,
        nextRecurrence: values.recurrence,
        previousTagIds: task.tags.map((tag) => tag.id),
        nextTagIds: values.tagIds,
      });

      if (decision.action === "prompt") {
        setPendingUpdate(values);
        setTagScope(decision.defaultScope);
        setShowTagScopeDialog(true);
        return false;
      }

      commitUpdate(values, decision.scope);
      return true;
    },
    [
      commitUpdate,
      createTask,
      isCreateMode,
      isRecurring,
      resolvedRecurrence,
      task,
    ]
  );

  // Register submit callback for parent-controlled save (e.g. creation popover).
  useEffect(() => {
    if (!onRegisterSubmit) {
      return;
    }
    onRegisterSubmit(() => submit(getValues()));
  }, [getValues, onRegisterSubmit, submit]);

  const handleSaveClick = useCallback(() => {
    const result = submit(getValues());
    if (result) {
      onClose();
    }
  }, [getValues, onClose, submit]);

  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSaveClick();
    },
    { enabled: open && showActionButtons, enableOnFormTags: true },
    [handleSaveClick, open, showActionButtons]
  );

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

  useEffect(() => {
    if (!onRegisterCreateInterop) {
      return;
    }

    onRegisterCreateInterop({
      applySharedFields,
      getSharedFields,
    });

    return () => {
      onRegisterCreateInterop(null);
    };
  }, [applySharedFields, getSharedFields, onRegisterCreateInterop]);

  // Format start time for the time input (HH:mm) - uses watchedValues for reactivity
  const startTimeValue = watchedValues.startTime
    ? `${String(watchedValues.startTime.hour).padStart(2, "0")}:${String(watchedValues.startTime.minute).padStart(2, "0")}`
    : "";

  const handleTimeChange = (value: string) => {
    if (!value) {
      setValue("startTime", null, { shouldDirty: true });
      return;
    }
    const [hours, minutes] = value.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return;
    }

    // Create PlainTime directly (just time of day, no date)
    const next = Temporal.PlainTime.from({ hour: hours, minute: minutes });
    setValue("startTime", next, { shouldDirty: true });
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
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
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {field.value
                      ? `Start: ${formatPlainDate(field.value, {
                          month: "short",
                          day: "numeric",
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
                      onClick={() => field.onChange(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <X className="h-4 w-4" />
                      Clear date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              className={cn(
                "justify-start gap-2 text-left font-medium text-xs",
                !startTimeValue && "text-muted-foreground"
              )}
              variant="outline"
            >
              <Clock3 className="h-4 w-4 shrink-0" />
              <span className="truncate">{startTimeValue || "Time"}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[220px]">
            <Label className="text-muted-foreground text-xs">Start time</Label>
            <Input
              className="mt-2"
              onChange={(e) => handleTimeChange(e.target.value)}
              step={300}
              type="time"
              value={startTimeValue}
            />
          </PopoverContent>
        </Popover>

        <Controller
          control={control}
          name="durationMinutes"
          render={({ field }) => (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  className="justify-start gap-2 text-xs"
                  variant="outline"
                >
                  <Timer className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {field.value ? `${field.value}m` : "Duration"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[220px] space-y-2">
                <Label className="text-muted-foreground text-xs">
                  Duration (minutes)
                </Label>
                <Input
                  min={5}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === ""
                        ? undefined
                        : Number.parseInt(e.target.value, 10)
                    )
                  }
                  step={5}
                  type="number"
                  value={field.value ?? ""}
                />
              </PopoverContent>
            </Popover>
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
                  <CalendarCheck className="h-4 w-4 shrink-0" />
                  {field.value
                    ? `Due: ${formatPlainDate(field.value, {
                        month: "short",
                        day: "numeric",
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
                      <X className="h-4 w-4" />
                      Clear date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
        />

        {/* Recurrence editor */}
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

      <Separator />

      <LinkListEditor
        isParsing={parseLink.isPending}
        links={links}
        onAddLink={(url) => {
          // Insert an unknown placeholder immediately so the link
          // is persisted even if the user saves before parse completes.
          const placeholder: LinkMeta = {
            provider: "unknown",
            url,
            fetchedAt: new Date().toISOString(),
          };
          const currentLinks =
            (getValues("links") as unknown as LinkMeta[]) ?? [];
          const isFirstLink = currentLinks.length === 0;
          setValue("links", dedupeLinks([...currentLinks, placeholder]), {
            shouldDirty: true,
          });

          // Upgrade the placeholder in-place when metadata arrives
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

      {showActionButtons ? (
        <>
          <Separator />
          <div className="flex items-center gap-2">
            {isCreateMode ? null : (
              <AlertDialog
                onOpenChange={setShowDeleteConfirm}
                open={showDeleteConfirm}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    className="gap-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete task?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {isRecurring
                        ? "This is a recurring task. Choose what to delete."
                        : "This action cannot be undone."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter
                    className={isRecurring ? "flex-col gap-2 sm:flex-col" : ""}
                  >
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    {isRecurring ? (
                      <>
                        <AlertDialogAction
                          autoFocus
                          onClick={() => confirmDelete("this")}
                        >
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
                      <AlertDialogAction
                        autoFocus
                        onClick={() => confirmDelete("this")}
                      >
                        Delete
                      </AlertDialogAction>
                    )}
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <div className="ml-auto flex gap-2">
              <Button onClick={onClose} size="sm" type="button" variant="ghost">
                Cancel
              </Button>
              <Button onClick={handleSaveClick} size="sm" type="button">
                Save
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {/* Recurrence scope dialog for recurring task updates (rendered outside action row) */}
      {isCreateMode ? null : (
        <RecurrenceScopeDialog
          confirmLabel="Apply"
          description="This is a recurring task. Choose how broadly to apply the change."
          onConfirm={() => {
            if (!pendingUpdate) {
              return;
            }
            commitUpdate(pendingUpdate, tagScope);
            setPendingUpdate(null);
            onClose();
          }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setPendingUpdate(null);
            }
            setShowTagScopeDialog(nextOpen);
          }}
          onValueChange={(value) => setTagScope(value as UpdateScope)}
          open={showTagScopeDialog}
          options={TASK_UPDATE_SCOPE_OPTIONS}
          title="Apply task update"
          value={tagScope}
        />
      )}
    </form>
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
        // biome-ignore lint: external CDN hosts aren't in next.config remotePatterns
        <img
          alt={meta.title ?? "Link thumbnail"}
          className="size-10 shrink-0 rounded object-cover"
          height={40}
          loading="lazy"
          src={meta.thumbnailUrl}
          width={40}
        />
      )}
      <button
        className="min-w-0 flex-1 space-y-0.5 text-left"
        onClick={() => window.open(meta.url, "_blank", "noopener,noreferrer")}
        tabIndex={-1}
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
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          onClick={onRemove}
          tabIndex={-1}
          type="button"
        >
          <XCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Multi-link editor: renders link list + add input, delegates mutations to parent */
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
        <button
          className="absolute top-1/2 left-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground"
          tabIndex={-1}
          type="button"
        >
          <Link2 className="h-4 w-4" />
        </button>
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
          <Loader2 className="absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
