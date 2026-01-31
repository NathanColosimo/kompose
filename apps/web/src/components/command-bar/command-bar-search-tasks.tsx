"use client";

import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { CheckCircle2Icon, CircleDotIcon, CircleIcon } from "lucide-react";
import { useMemo } from "react";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useTasks } from "@/hooks/use-tasks";

interface CommandBarSearchTasksProps {
  search: string;
}

/**
 * Get the appropriate icon for a task status.
 */
function getStatusIcon(status: "todo" | "in_progress" | "done") {
  switch (status) {
    case "done":
      return CheckCircle2Icon;
    case "in_progress":
      return CircleDotIcon;
    default:
      return CircleIcon;
  }
}

/**
 * CommandBarSearchTasks - Task search sub-view in the command bar.
 *
 * Filters tasks based on the search input and displays matching results.
 * Uses client-side filtering since all tasks are already fetched.
 */
export function CommandBarSearchTasks({ search }: CommandBarSearchTasksProps) {
  const { tasksQuery } = useTasks();
  const { data: tasks, isLoading } = tasksQuery;

  // Filter tasks based on search query (case-insensitive title match)
  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    if (!search.trim()) return tasks;

    const query = search.toLowerCase();
    return tasks.filter((task: TaskSelectDecoded) =>
      task.title.toLowerCase().includes(query)
    );
  }, [tasks, search]);

  if (isLoading) {
    return <CommandEmpty>Loading tasks...</CommandEmpty>;
  }

  if (filteredTasks.length === 0) {
    return (
      <CommandEmpty>
        {search ? "No tasks found." : "No tasks yet."}
      </CommandEmpty>
    );
  }

  return (
    <CommandGroup heading="Tasks">
      {filteredTasks.map((task) => {
        const StatusIcon = getStatusIcon(task.status);
        return (
          <CommandItem
            key={task.id}
            onSelect={() => {
              // Future: open task edit popover or navigate
              console.log("Selected task:", task.id);
            }}
            value={task.title}
          >
            <StatusIcon className="text-muted-foreground" />
            <span className="flex-1 truncate">{task.title}</span>
            {task.dueDate && (
              <span className="text-muted-foreground text-xs">
                {task.dueDate.toString()}
              </span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
