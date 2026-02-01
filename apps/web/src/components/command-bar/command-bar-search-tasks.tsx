"use client";

import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  commandBarOpenAtom,
  focusedTaskIdAtom,
} from "@kompose/state/atoms/command-bar";
import { currentDateAtom } from "@kompose/state/atoms/current-date";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useSetAtom } from "jotai";
import {
  CalendarIcon,
  CircleDotIcon,
  CircleIcon,
  InboxIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { formatPlainDate } from "@/lib/temporal-utils";

interface CommandBarSearchTasksProps {
  search: string;
}

/**
 * Get the appropriate icon for a task status.
 */
function getStatusIcon(status: "todo" | "in_progress" | "done") {
  switch (status) {
    case "in_progress":
      return CircleDotIcon;
    default:
      return CircleIcon;
  }
}

/**
 * Check if a task is scheduled on the calendar (has both startDate and startTime).
 */
function isScheduledOnCalendar(task: TaskSelectDecoded): boolean {
  return task.startDate !== null && task.startTime !== null;
}

/**
 * CommandBarSearchTasks - Task search sub-view in the command bar.
 *
 * Filters tasks based on the search input and displays matching results.
 * Only shows uncompleted, non-recurring tasks.
 * Selecting a task navigates to its location and opens the edit popover.
 */
export function CommandBarSearchTasks({ search }: CommandBarSearchTasksProps) {
  const { tasksQuery } = useTasks();
  const { data: tasks, isLoading } = tasksQuery;

  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);
  const setFocusedTaskId = useSetAtom(focusedTaskIdAtom);
  const setCurrentDate = useSetAtom(currentDateAtom);

  // Filter tasks: exclude completed, exclude recurring, match search query
  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    // Base filters: exclude completed and recurring tasks
    const searchable = tasks.filter(
      (task: TaskSelectDecoded) =>
        task.status !== "done" && task.seriesMasterId === null
    );

    // If no search query, return all searchable tasks
    if (!search.trim()) return searchable;

    // Filter by title match
    const query = search.toLowerCase();
    return searchable.filter((task: TaskSelectDecoded) =>
      task.title.toLowerCase().includes(query)
    );
  }, [tasks, search]);

  // Handle task selection: navigate to task and open edit popover
  const handleSelectTask = useCallback(
    (task: TaskSelectDecoded) => {
      // If task is scheduled on calendar, navigate to that date
      if (isScheduledOnCalendar(task) && task.startDate) {
        setCurrentDate(task.startDate);
      }

      // Set the focused task ID to trigger the popover to open
      setFocusedTaskId(task.id);

      // Close the command bar
      setCommandBarOpen(false);
    },
    [setCurrentDate, setFocusedTaskId, setCommandBarOpen]
  );

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
        const isScheduled = isScheduledOnCalendar(task);

        return (
          <CommandItem
            key={task.id}
            onSelect={() => handleSelectTask(task)}
            value={task.title}
          >
            <StatusIcon className="text-muted-foreground" />
            <span className="flex-1 truncate">{task.title}</span>

            {/* Location indicator */}
            {isScheduled ? (
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <CalendarIcon className="size-3" />
                {task.startDate &&
                  formatPlainDate(task.startDate, {
                    month: "short",
                    day: "numeric",
                  })}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <InboxIcon className="size-3" />
                Inbox
              </span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
