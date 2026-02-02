"use client";

import type {
  DeleteScope,
  TaskRecurrence,
  TaskSelectDecoded,
} from "@kompose/api/routers/task/contract";
import { focusedTaskIdAtom } from "@kompose/state/atoms/command-bar";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useAtom } from "jotai";
import {
  CalendarCheck,
  CalendarClock,
  Clock3,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Controller,
  type SubmitHandler,
  useForm,
  useWatch,
} from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { Temporal } from "temporal-polyfill";
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
import { Label } from "../ui/label";
import { RecurrenceEditor } from "./recurrence-editor";

/** Form state uses Temporal types, convert to native Date only at picker boundary */
interface TaskFormValues {
  title: string;
  description: string;
  /** Start date - when task appears in inbox or on calendar */
  startDate: Temporal.PlainDate | null;
  /** Start time - time of day for calendar scheduling (independent of startDate) */
  startTime: Temporal.PlainTime | null;
  /** Due date - when task is due */
  dueDate: Temporal.PlainDate | null;
  durationMinutes: number;
  /** Recurrence pattern (null = non-recurring) */
  recurrence: TaskRecurrence | null;
}

interface TaskEditPopoverProps {
  task: TaskSelectDecoded;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

/**
 * Shared popover for inline task editing (title, description, start date/time, duration).
 */
export function TaskEditPopover({
  task,
  children,
  side = "right",
  align = "start",
}: TaskEditPopoverProps) {
  const [open, setOpen] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useAtom(focusedTaskIdAtom);

  // Open popover when this task is focused via command bar search
  useEffect(() => {
    if (focusedTaskId === task.id) {
      setOpen(true);
      // Clear the focused task ID after opening
      setFocusedTaskId(null);
    }
  }, [focusedTaskId, task.id, setFocusedTaskId]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && submitRef.current) {
      submitRef.current();
    }
    setOpen(nextOpen);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[360px] space-y-3 p-4"
        side={side}
      >
        <TaskEditForm
          key={task.id}
          onClose={handleClose}
          onRegisterSubmit={(fn) => {
            submitRef.current = fn;
          }}
          open={open}
          task={task}
        />
      </PopoverContent>
    </Popover>
  );
}

function TaskEditForm({
  task,
  onRegisterSubmit,
  onClose,
  open,
}: {
  task: TaskSelectDecoded;
  onRegisterSubmit: (fn: () => void) => void;
  onClose: () => void;
  open: boolean;
}) {
  const { updateTask, deleteTask } = useTasks();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Check if this task is part of a recurring series
  const isRecurring = task.seriesMasterId !== null;

  // Opens confirmation dialog
  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  // Delete with specified scope
  const confirmDelete = useCallback(
    (scope: DeleteScope) => {
      onClose();
      deleteTask.mutate({ id: task.id, scope });
    },
    [deleteTask, onClose, task.id]
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
    { enabled: open },
    [handleDeleteClick, open]
  );

  const initialValues = useMemo<TaskFormValues>(
    () => ({
      title: task.title ?? "",
      description: task.description ?? "",
      startDate: task.startDate ?? null,
      startTime: task.startTime ?? null,
      dueDate: task.dueDate ?? null,
      durationMinutes: task.durationMinutes ?? 30,
      recurrence: task.recurrence ?? null,
    }),
    [
      task.description,
      task.dueDate,
      task.durationMinutes,
      task.recurrence,
      task.startDate,
      task.startTime,
      task.title,
    ]
  );

  const {
    control,
    reset,
    setValue,
    handleSubmit,
    getValues,
    formState: { isDirty },
  } = useForm<TaskFormValues>({
    defaultValues: initialValues,
  });

  // Keep the form in sync if the task changes externally.
  useEffect(() => {
    reset(initialValues, { keepDirty: false });
  }, [initialValues, reset]);

  const watchedValues = useWatch({ control });
  // Separate watch for startDate to preserve Temporal.PlainDate type (useWatch returns deeply partial)
  const startDate = useWatch({ control, name: "startDate" });

  const submit = useCallback<SubmitHandler<TaskFormValues>>(
    (values) => {
      const normalizedDuration =
        Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
          ? Math.round(values.durationMinutes)
          : (task.durationMinutes ?? 30);

      // Non-recurring tasks or recurring tasks with no recurrence change: scope="this"
      // Recurrence pattern changes force scope="following"
      const recurrenceChanged =
        JSON.stringify(values.recurrence) !==
        JSON.stringify(task.recurrence ?? null);

      updateTask.mutate({
        id: task.id,
        task: {
          title: values.title.trim(),
          description: values.description ?? "",
          startDate: values.startDate,
          startTime: values.startTime,
          dueDate: values.dueDate,
          durationMinutes: normalizedDuration,
          recurrence: values.recurrence,
        },
        // Use "following" scope if recurrence changed, otherwise "this"
        scope: recurrenceChanged ? "following" : "this",
      });
    },
    [task.durationMinutes, task.id, task.recurrence, updateTask]
  );

  // Register submit callback so the popover can trigger save on close.
  // Only submit if the form has been modified.
  useEffect(() => {
    onRegisterSubmit(() => {
      if (isDirty) {
        submit(getValues());
      }
    });
  }, [getValues, isDirty, onRegisterSubmit, submit]);

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

      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Title
        </Label>
        <Input
          onChange={(e) =>
            setValue("title", e.target.value, { shouldDirty: true })
          }
          placeholder="Task title"
          value={watchedValues.title}
        />
      </div>

      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Description
        </Label>
        <Textarea
          onChange={(e) =>
            setValue("description", e.target.value, { shouldDirty: true })
          }
          placeholder="Add details..."
          value={watchedValues.description}
        />
      </div>

      <Separator />

      {/* Delete button with confirmation dialog - shows scope options for recurring tasks */}
      <AlertDialog onOpenChange={setShowDeleteConfirm} open={showDeleteConfirm}>
        <AlertDialogTrigger asChild>
          <Button
            className="w-full gap-2 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            type="button"
            variant="outline"
          >
            <Trash2 className="h-4 w-4" />
            Delete task
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
                {/* Auto-focus "Only this" as the safer default for recurring tasks */}
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
              // Auto-focus delete button so Enter confirms deletion
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
    </form>
  );
}
