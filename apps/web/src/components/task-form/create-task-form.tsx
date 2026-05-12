"use client";

import type { ClientTaskInsertDecoded } from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { CalendarIcon, Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { Temporal } from "temporal-polyfill";
import { TagPicker } from "@/components/tags/tag-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DurationPicker } from "@/components/ui/duration-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import {
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
  todayPlainDate,
} from "@/lib/temporal-utils";
import { RecurrenceEditor } from "./recurrence-editor";

const EMPTY_TAG_IDS: string[] = [];

const buildDefaultValues = (tagIds: string[]) => ({
  title: "",
  description: "",
  startDate: todayPlainDate(),
  startTime: null,
  durationMinutes: 30,
  dueDate: todayPlainDate().add({ days: 1 }),
  recurrence: null,
  tagIds,
});

export function CreateTaskForm({
  defaultTagIds = EMPTY_TAG_IDS,
}: {
  defaultTagIds?: string[];
}) {
  const [open, setOpen] = useState(false);

  const { createTask } = useTasks();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { isSubmitting },
  } = useForm<ClientTaskInsertDecoded>({
    defaultValues: buildDefaultValues(defaultTagIds),
  });

  // Watch startDate for recurrence editor reference
  const startDate = useWatch({ control, name: "startDate" });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      reset(buildDefaultValues(defaultTagIds));
    }
  };

  const onSubmit = useCallback(
    async (data: ClientTaskInsertDecoded) => {
      await createTask.mutateAsync(data);
      reset(buildDefaultValues(defaultTagIds));
      setOpen(false);
    },
    [createTask, defaultTagIds, reset]
  );

  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSubmit(onSubmit)();
    },
    { enabled: open, enableOnFormTags: true },
    [handleSubmit, onSubmit, open]
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button className="size-8" size="icon" variant="ghost">
          <Plus className="size-4" />
          <span className="sr-only">Create Task</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4 py-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="Task title" {...register("title")} />
          </div>
          <div className="grid gap-2">
            <Label>Duration</Label>
            <Controller
              control={control}
              name="durationMinutes"
              render={({ field }) => (
                <DurationPicker
                  className="w-full"
                  onChange={(minutes) => field.onChange(minutes)}
                  value={field.value}
                />
              )}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Add details..."
              {...register("description")}
            />
          </div>
          <div className="grid gap-2">
            <Label>Tags</Label>
            <Controller
              control={control}
              name="tagIds"
              render={({ field }) => (
                <TagPicker
                  onChange={field.onChange}
                  value={field.value ?? []}
                />
              )}
            />
          </div>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Start Date</Label>
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        className={`w-full justify-start text-left font-normal ${
                          !field.value && "text-muted-foreground"
                        }`}
                        variant="outline"
                      >
                        <CalendarIcon className="mr-2 size-4" />
                        {field.value ? (
                          formatPlainDate(field.value, { dateStyle: "long" })
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        onSelect={(date) =>
                          field.onChange(
                            date ? pickerDateToTemporal(date) : null
                          )
                        }
                        selected={
                          field.value
                            ? temporalToPickerDate(field.value)
                            : undefined
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
            </div>
            <div className="grid gap-2">
              <Label>Start Time</Label>
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
                      className="w-full"
                      onChange={(nextValue) => {
                        if (!nextValue) {
                          field.onChange(null);
                          return;
                        }
                        const [hours, minutes] = nextValue
                          .split(":")
                          .map(Number);
                        if (Number.isNaN(hours) || Number.isNaN(minutes)) {
                          return;
                        }
                        field.onChange(
                          Temporal.PlainTime.from({
                            hour: hours,
                            minute: minutes,
                          })
                        );
                      }}
                      placeholder="Pick a time"
                      value={value}
                    />
                  );
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Due Date</Label>
              <Controller
                control={control}
                name="dueDate"
                render={({ field }) => (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        className={`w-full justify-start text-left font-normal ${
                          !field.value && "text-muted-foreground"
                        }`}
                        variant="outline"
                      >
                        <CalendarIcon className="mr-2 size-4" />
                        {field.value ? (
                          formatPlainDate(field.value, { dateStyle: "long" })
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        onSelect={(date) =>
                          field.onChange(
                            date ? pickerDateToTemporal(date) : null
                          )
                        }
                        selected={
                          field.value
                            ? temporalToPickerDate(field.value)
                            : undefined
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
            </div>
            {/* Recurrence */}
            <div className="grid gap-2">
              <Label>Repeat</Label>
              <Controller
                control={control}
                name="recurrence"
                render={({ field }) => (
                  <RecurrenceEditor
                    onChange={field.onChange}
                    referenceDate={startDate}
                    value={field.value ?? null}
                  />
                )}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
