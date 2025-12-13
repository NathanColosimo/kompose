"use client";

import type { TaskSelect } from "@kompose/db/schema/task";
import { format, set } from "date-fns";
import {
  CalendarCheck,
  CalendarIcon,
  Clock3,
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
import { useTaskMutations } from "@/hooks/use-update-task-mutation";
import { cn } from "@/lib/utils";
import { Label } from "../ui/label";

type TaskFormValues = {
  title: string;
  description: string;
  startDateTime: Date | null;
  dueDate: Date | null;
  durationMinutes: number;
};

type TaskEditPopoverProps = {
  task: TaskSelect;
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
  task: TaskSelect;
  onRegisterSubmit: (fn: () => void) => void;
  onClose: () => void;
  open: boolean;
}) {
  const { updateTask, deleteTask } = useTaskMutations();
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
      // Parse ISO timestamp string to Date for form
      startDateTime: task.startTime ? new Date(task.startTime) : null,
      // Parse YYYY-MM-DD string to Date for form (appending T00:00 to parse as local)
      dueDate: task.dueDate ? new Date(`${task.dueDate}T00:00`) : null,
      durationMinutes: task.durationMinutes ?? 30,
    }),
    [
      task.description,
      task.dueDate,
      task.durationMinutes,
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

      // Convert Date to local datetime string for startTime (Postgres timestamp without timezone)
      const startTimeStr = values.startDateTime
        ? format(values.startDateTime, "yyyy-MM-dd'T'HH:mm:ss")
        : null;

      // Convert Date to YYYY-MM-DD string for startDate (using local timezone to avoid date shift)
      const startDateStr = values.startDateTime
        ? format(values.startDateTime, "yyyy-MM-dd")
        : null;

      // Convert Date to YYYY-MM-DD string for dueDate (using local timezone to avoid date shift)
      const dueDateStr = values.dueDate
        ? format(values.dueDate, "yyyy-MM-dd")
        : null;

      updateTask.mutate({
        id: task.id,
        task: {
          title: values.title.trim(),
          description: values.description ?? "",
          startDate: startDateStr,
          startTime: startTimeStr,
          dueDate: dueDateStr,
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

  const startTimeValue = watchedValues.startDateTime
    ? format(watchedValues.startDateTime, "HH:mm")
    : "";

  const handleTimeChange = (value: string) => {
    if (!value) {
      setValue("startDateTime", null, { shouldDirty: true });
      return;
    }
    const [hours, minutes] = value.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return;
    }

    const base = watchedValues.startDateTime ?? new Date();
    const next = set(base, {
      hours,
      minutes,
      seconds: 0,
      milliseconds: 0,
    });

    setValue("startDateTime", next, { shouldDirty: true });
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
      {/* Row 1: Start date, Start time, Duration */}
      <div className="grid grid-cols-3 gap-2">
        <Controller
          control={control}
          name="startDateTime"
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
                  <CalendarIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {field.value ? format(field.value, "LLL dd") : "Start"}
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
                    const current = field.value ?? new Date();
                    const merged = set(current, {
                      year: date.getFullYear(),
                      month: date.getMonth(),
                      date: date.getDate(),
                    });
                    field.onChange(merged);
                  }}
                  selected={field.value ?? undefined}
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

      {/* Row 2: Due date */}
      <Controller
        control={control}
        name="dueDate"
        render={({ field }) => (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className={cn(
                  "w-full justify-start gap-2 text-left font-medium text-xs",
                  !field.value && "text-muted-foreground"
                )}
                variant="outline"
              >
                <CalendarCheck className="h-4 w-4 shrink-0" />
                {field.value ? format(field.value, "LLL dd, yyyy") : "Due date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                onSelect={(date) => field.onChange(date ?? null)}
                selected={field.value ?? undefined}
              />
            </PopoverContent>
          </Popover>
        )}
      />

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
