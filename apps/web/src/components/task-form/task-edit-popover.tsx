"use client";

import type {
  ClientTaskInsertDecoded,
  DeleteScope,
  LinkMeta,
  TaskRecurrence,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { commandBarTaskOpenRequestAtom } from "@kompose/state/atoms/command-bar";
import { useLinkMetadata } from "@kompose/state/hooks/use-link-metadata";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  dedupeLinks,
  getLinkDurationMinutes,
  getLinkWordCount,
  getProviderLabel,
  URL_REGEX,
} from "@kompose/state/link-meta-utils";
import {
  applyLinkMetadata,
  type LinkEditedFields,
} from "@kompose/state/link-metadata";
import { TASK_UPDATE_SCOPE_OPTIONS } from "@kompose/state/recurrence-scope-options";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
} from "@kompose/state/task-recurrence";
import { useAtomValue, useSetAtom } from "jotai";
import {
  CalendarCheck,
  CalendarClock,
  Link2,
  Loader2,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
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
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { selectTaskOpenRequestAtom } from "@/state/command-bar";
import type {
  CalendarCreateFormInterop,
  CalendarCreateSharedFields,
} from "../calendar/event-creation/create-form-shared";
import { Label } from "../ui/label";
import { RecurrenceEditor } from "./recurrence-editor";
import { taskEditorPhaseReducer } from "./task-editor-phase";

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
  initialValues?: Partial<TaskFormValues>;
  mode?: "create" | "edit";
  side?: "top" | "right" | "bottom" | "left";
  surface: "calendar" | "sidebar";
  task?: TaskSelectDecoded;
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
    description: task.description ?? "",
    dueDate: task.dueDate ?? null,
    durationMinutes: task.durationMinutes ?? 30,
    links: task.links ?? [],
    recurrence: resolvedRecurrence ?? null,
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
  initialValues,
  mode: modeProp,
  surface,
  side = "right",
  align = "start",
}: TaskEditPopoverProps) {
  const mode = modeProp ?? (task ? "edit" : "create");
  const [open, setOpen] = useState(false);
  const requestAtom = useMemo(
    () =>
      selectTaskOpenRequestAtom(
        mode === "edit" ? task?.id : undefined,
        surface
      ),
    [mode, task?.id, surface]
  );
  const openRequest = useAtomValue(requestAtom);
  const setOpenRequest = useSetAtom(commandBarTaskOpenRequestAtom);
  const matchesOpenRequest = openRequest !== null;

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
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
        className="w-[360px] space-y-3 p-4"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onOpenAutoFocus={handleOpenAutoFocus}
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
  submitRef,
  onClose,
  open,
  createInteropRef,
}: {
  task?: TaskSelectDecoded;
  initialValues?: Partial<TaskFormValues>;
  mode: "create" | "edit";
  /** When provided, the parent controls save (e.g. creation popover). Otherwise the form shows its own Save/Cancel buttons. */
  submitRef?: React.Ref<() => boolean>;
  onClose: () => void;
  open: boolean;
  createInteropRef?: React.Ref<CalendarCreateFormInterop>;
}) {
  const showActionButtons = !submitRef;
  const { createTask, updateTask, deleteTask, tasksQuery } = useTasks();
  const [phase, setPhase] = useReducer(taskEditorPhaseReducer, {
    type: "editing",
  });
  const isCreateMode = mode === "create";

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

  const handleDeleteClick = useCallback(() => {
    setPhase({ type: "delete" });
  }, []);

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
    { enabled: open && !isCreateMode && phase.type === "editing" },
    [handleDeleteClick, isCreateMode, open]
  );

  const resolvedInitialValues = useMemo<TaskFormValues>(
    () =>
      buildTaskInitialValues({
        initialValues: initialCreateValues,
        resolvedRecurrence,
        task,
      }),
    [initialCreateValues, resolvedRecurrence, task]
  );

  const { control, setValue, handleSubmit, getValues } =
    useForm<TaskFormValues>({
      defaultValues: resolvedInitialValues,
    });

  const watchedValues = useWatch({ control });
  // Separate watch for startDate to preserve Temporal.PlainDate type (useWatch returns deeply partial)
  const startDate = useWatch({ control, name: "startDate" });
  // Separate watch for links to preserve array type
  const links = useWatch({ control, name: "links" });
  const editedLinkFields = useRef<LinkEditedFields>({
    durationMinutes:
      mode === "edit" || initialCreateValues?.durationMinutes !== undefined,
    title: false,
  });
  const linkQueries = useLinkMetadata(links, open);

  useEffect(() => {
    if (!open) {
      return;
    }
    for (const { url, data } of linkQueries) {
      if (!data) {
        continue;
      }
      const current = getValues();
      const next = applyLinkMetadata(
        current,
        url,
        data,
        editedLinkFields.current
      );
      if (next === current) {
        continue;
      }
      setValue("links", next.links, { shouldDirty: true });
      if (next.title !== current.title) {
        setValue("title", next.title, { shouldDirty: true });
      }
      if (next.durationMinutes !== current.durationMinutes) {
        setValue("durationMinutes", next.durationMinutes, {
          shouldDirty: true,
        });
      }
    }
  }, [getValues, linkQueries, open, setValue]);

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
        },
      });
    },
    [task, updateTask]
  );

  const submit = useCallback(
    (values: TaskFormValues) => {
      if (phase.type !== "editing") {
        return false;
      }
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
      });

      if (decision.action === "prompt") {
        setPhase({ type: "scope", values, scope: decision.defaultScope });
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
      phase.type,
      resolvedRecurrence,
      task,
    ]
  );

  useImperativeHandle(submitRef, () => () => submit(getValues()), [
    getValues,
    submit,
  ]);

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
    {
      enabled: open && showActionButtons && phase.type === "editing",
      enableOnFormTags: true,
    },
    [handleSaveClick, open, showActionButtons]
  );

  const applySharedFields = useCallback(
    (fields: CalendarCreateSharedFields) => {
      editedLinkFields.current.durationMinutes = true;
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
      <Input
        onChange={(e) => {
          editedLinkFields.current.title = true;
          setValue("title", e.target.value, { shouldDirty: true });
        }}
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
              onChange={(minutes) => {
                editedLinkFields.current.durationMinutes = true;
                field.onChange(minutes);
              }}
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

      <Separator />

      <LinkListEditor
        isParsing={linkQueries.some((query) => query.isPending)}
        links={links}
        onAddLink={(url) => {
          // Insert an unknown placeholder immediately so the link
          // is persisted even if the user saves before parse completes.
          const placeholder: LinkMeta = {
            fetchedAt: new Date().toISOString(),
            provider: "unknown",
            url,
          };
          const currentLinks = getValues("links");
          setValue("links", dedupeLinks([...currentLinks, placeholder]), {
            shouldDirty: true,
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
                onOpenChange={(nextOpen) => {
                  setPhase({ type: nextOpen ? "delete" : "editing" });
                }}
                open={phase.type === "delete"}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    className="gap-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    disabled={phase.type !== "editing"}
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
                      <AlertDialogAction onClick={() => confirmDelete("this")}>
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
              <Button
                disabled={phase.type !== "editing"}
                onClick={handleSaveClick}
                size="sm"
                type="button"
              >
                Save
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {/* Recurrence scope dialog for recurring task updates (rendered outside action row) */}
      {phase.type === "scope" && (
        <RecurrenceScopeDialog
          confirmLabel="Apply"
          description="This is a recurring task. Choose how broadly to apply the change."
          onConfirm={() => {
            commitUpdate(phase.values, phase.scope);
            setPhase({ type: "editing" });
            onClose();
          }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setPhase({ type: "editing" });
            }
          }}
          onValueChange={(scope) => {
            if (scope === "this" || scope === "following") {
              setPhase({ type: "select-scope", scope });
            }
          }}
          open
          options={TASK_UPDATE_SCOPE_OPTIONS}
          title="Apply task update"
          value={phase.scope}
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
