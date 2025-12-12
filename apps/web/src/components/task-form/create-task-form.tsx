"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type TaskInsert, taskInsertSchema } from "@kompose/db/schema/task";
import { format } from "date-fns";
import { CalendarIcon, Plus } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
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
import { useTaskMutations } from "@/hooks/use-update-task-mutation";

export function CreateTaskForm() {
  const [open, setOpen] = useState(false);

  const { createTask } = useTaskMutations();

  /** Helper to get default due date (tomorrow) */
  const getDefaultDueDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  };

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(taskInsertSchema),
    defaultValues: {
      userId: "",
      title: "",
      description: "",
      startDate: new Date(),
      durationMinutes: 30,
      dueDate: getDefaultDueDate(),
    },
  });

  const onSubmit = async (data: TaskInsert) => {
    await createTask.mutateAsync(data);
    // Reset form to fresh defaults and close dialog
    reset({
      userId: "",
      title: "",
      description: "",
      startDate: new Date(),
      durationMinutes: 30,
      dueDate: getDefaultDueDate(),
    });
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
            {errors.title?.message ? (
              <p className="text-destructive text-xs">{errors.title.message}</p>
            ) : null}
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
            {errors.durationMinutes?.message ? (
              <p className="text-destructive text-xs">
                {errors.durationMinutes.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Add details..."
              {...register("description")}
            />
            {errors.description?.message ? (
              <p className="text-destructive text-xs">
                {errors.description.message}
              </p>
            ) : null}
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
                        variant={"outline"}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        onSelect={field.onChange}
                        selected={
                          // biome-ignore lint/nursery/noLeakedRender: Field prop
                          field.value ? new Date(field.value) : undefined
                        }
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
              {errors.startDate?.message ? (
                <p className="text-destructive text-xs">
                  {errors.startDate.message}
                </p>
              ) : null}
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
                        variant={"outline"}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        onSelect={field.onChange}
                        selected={
                          // biome-ignore lint/nursery/noLeakedRender: Field prop
                          field.value ? new Date(field.value) : undefined
                        }
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
              {errors.dueDate?.message ? (
                <p className="text-destructive text-xs">
                  {errors.dueDate.message}
                </p>
              ) : null}
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
