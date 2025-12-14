"use client";

import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useAtomValue } from "jotai";
import {
  CalendarCheck,
  CalendarClock,
  Clock3,
  Inbox,
  Timer,
  Trash2,
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
import { timezoneAtom } from "@/atoms/current-date";
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
import { useTasks } from "@/hooks/use-tasks";
import {
  formatPlainDate,
  pickerDateToTemporal,
  plainDateTimeToPickerDate,
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { Label } from "../ui/label";

/** Form state uses Temporal types, convert to native Date only at picker boundary */
type TaskFormValues = {
  title: string;
  description: string;
  /** Scheduled calendar datetime */
  startTime: Temporal.PlainDateTime | null;
  /** Start date - when task appears in inbox */
  startDate: Temporal.PlainDate | null;
  /** Due date - when task is due */
  dueDate: Temporal.PlainDate | null;
  durationMinutes: number;
};

type TaskEditPopoverProps = {
  task: TaskSelectDecoded;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
};

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
  const timeZone = useAtomValue(timezoneAtom);
  const { updateTask, deleteTask } = useTasks();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Opens confirmation dialog
  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  // Actually deletes the task after confirmation
  const confirmDelete = useCallback(() => {
    onClose();
    deleteTask.mutate({ id: task.id });
  }, [deleteTask, onClose, task.id]);

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
      // task.startTime is already PlainDateTime from codec
      startTime: task.startTime ?? null,
      // task.startDate is Temporal.PlainDate from codec (inbox visibility)
      startDate: task.startDate ?? null,
      // task.dueDate is Temporal.PlainDate from codec
      dueDate: task.dueDate ?? null,
      durationMinutes: task.durationMinutes ?? 30,
    }),
    [
      task.description,
      task.dueDate,
      task.durationMinutes,
      task.startDate,
      task.startTime,
      task.title,
    ]
  );

  const { control, reset, setValue, handleSubmit, getValues } =
    useForm<TaskFormValues>({
      defaultValues: initialValues,
    });

  // Keep the form in sync if the task changes externally.
  useEffect(() => {
    reset(initialValues, { keepDirty: false });
  }, [initialValues, reset]);

  const watchedValues = useWatch({ control });

  const submit = useCallback<SubmitHandler<TaskFormValues>>(
    (values) => {
      const normalizedDuration =
        Number.isFinite(values.durationMinutes) && values.durationMinutes > 0
          ? Math.round(values.durationMinutes)
          : (task.durationMinutes ?? 30);

      // Pass Temporal types directly - mutation handles encoding
      updateTask.mutate({
        id: task.id,
        task: {
          title: values.title.trim(),
          description: values.description ?? "",
          startDate: values.startDate,
          startTime: values.startTime,
          dueDate: values.dueDate,
          durationMinutes: normalizedDuration,
        },
      });
    },
    [task.durationMinutes, task.id, updateTask]
  );

  // Register submit callback so the popover can trigger save on close.
  useEffect(() => {
    onRegisterSubmit(() => {
      submit(getValues());
    });
  }, [getValues, onRegisterSubmit, submit]);

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

    // Get the base datetime (either current startTime or now)
    const base =
      getValues("startTime") ?? Temporal.Now.plainDateTimeISO(timeZone);
    // Update only the time portion
    const next = base.with({ hour: hours, minute: minutes, second: 0 });

    setValue("startTime", next, { shouldDirty: true });
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
      {/* Row 1: Start time date, time, duration (calendar slot) */}
      <div className="grid grid-cols-3 gap-2">
        <Controller
          control={control}
          name="startTime"
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
                      ? formatPlainDate(field.value.toPlainDate(), {
                          month: "short",
                          day: "numeric",
                        })
                      : "Schedule"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="single"
                  onSelect={(date) => {
                    if (!date) {
                      field.onChange(null);
                      return;
                    }
                    // Convert picker Date to PlainDate, preserve time
                    const pickerDate = pickerDateToTemporal(date);
                    const current =
                      field.value ?? Temporal.Now.plainDateTimeISO(timeZone);
                    const next = current.with({
                      year: pickerDate.year,
                      month: pickerDate.month,
                      day: pickerDate.day,
                    });
                    field.onChange(next);
                  }}
                  selected={
                    field.value
                      ? plainDateTimeToPickerDate(field.value)
                      : undefined
                  }
                />
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

      {/* Row 2: Start date (inbox visibility) and Due date */}
      <div className="grid grid-cols-2 gap-2">
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
                  <Inbox className="h-4 w-4 shrink-0" />
                  {field.value
                    ? formatPlainDate(field.value, {
                        month: "short",
                        day: "numeric",
                      })
                    : "Start date"}
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
              </PopoverContent>
            </Popover>
          )}
        />

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
                    ? formatPlainDate(field.value, {
                        month: "short",
                        day: "numeric",
                      })
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
              </PopoverContent>
            </Popover>
          )}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Title
        </Label>
        <Input
          onChange={(e) => setValue("title", e.target.value)}
          placeholder="Task title"
          value={watchedValues.title}
        />
      </div>

      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Description
        </Label>
        <Textarea
          onChange={(e) => setValue("description", e.target.value)}
          placeholder="Add details..."
          value={watchedValues.description}
        />
      </div>

      <Separator />

      {/* Delete button with confirmation dialog */}
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
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
