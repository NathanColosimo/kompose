"use client";

import type { ClientTaskInsertDecoded } from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { CalendarIcon, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
  todayPlainDate,
} from "@/lib/temporal-utils";
import { RecurrenceEditor } from "./recurrence-editor";

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
  defaultTagIds = [],
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

  // Prefill tag context when opening from a tag view.
  useEffect(() => {
    if (open) {
      reset(buildDefaultValues(defaultTagIds));
    }
  }, [defaultTagIds, open, reset]);

  const onSubmit = async (data: ClientTaskInsertDecoded) => {
    await createTask.mutateAsync(data);
    // Reset form to fresh defaults and close dialog
    reset(buildDefaultValues(defaultTagIds));
    setOpen(false);
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="h-8 w-8" size="icon" variant="ghost">
          <Plus className="h-4 w-4" />
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
            <Label htmlFor="durationMinutes">Duration (minutes)</Label>
            <Input
              id="durationMinutes"
              min={5}
              step={5}
              type="number"
              {...register("durationMinutes", { valueAsNumber: true })}
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
                        <CalendarIcon className="mr-2 h-4 w-4" />
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
                            <X className="h-4 w-4" />
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
              <Label htmlFor="startTime">Start Time</Label>
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
                    <Input
                      id="startTime"
                      onChange={(event) => {
                        const nextValue = event.target.value;
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

                        // Convert time input into a Temporal.PlainTime for storage.
                        field.onChange(
                          Temporal.PlainTime.from({
                            hour: hours,
                            minute: minutes,
                          })
                        );
                      }}
                      type="time"
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
                        <CalendarIcon className="mr-2 h-4 w-4" />
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
                            <X className="h-4 w-4" />
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
