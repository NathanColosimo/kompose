"use client";

import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  commandBarOpenAtom,
  commandBarTaskOpenRequestAtom,
} from "@kompose/state/atoms/command-bar";
import {
  currentDateAtom,
  nowZonedDateTimeAtom,
  timezoneAtom,
  todayPlainDateAtom,
} from "@kompose/state/atoms/current-date";
import { sessionQueryAtom } from "@kompose/state/config";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  createCommandBarTaskOpenRequest,
  resolveTaskSearchDestination,
  serializeCommandBarTaskOpenRequest,
} from "@kompose/state/task-search-routing";
import { useAtomValue, useSetAtom } from "jotai";
import {
  CalendarIcon,
  CircleDotIcon,
  CircleIcon,
  InboxIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { uuidv7 } from "uuidv7";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  applyCommandBarTaskOpenRequest,
  COMMAND_BAR_TASK_OPEN_EVENT,
} from "@/lib/command-bar-task-routing";
import { isTauriRuntime } from "@/lib/tauri-desktop";
import { formatPlainDate } from "@/lib/temporal-utils";
import { sidebarLeftViewSelectionAtom } from "@/state/sidebar";

interface CommandBarSearchTasksProps {
  search: string;
  selectionMode?: "desktop-popup" | "local";
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
export function CommandBarSearchTasks({
  search,
  selectionMode = "local",
}: CommandBarSearchTasksProps) {
  const { tasksQuery } = useTasks();
  const sessionQuery = useAtomValue(sessionQueryAtom);
  const { data: tasks, isLoading } = tasksQuery;
  const today = useAtomValue(todayPlainDateAtom);
  const now = useAtomValue(nowZonedDateTimeAtom);
  const timeZone = useAtomValue(timezoneAtom);

  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);
  const setCommandBarTaskOpenRequest = useSetAtom(commandBarTaskOpenRequestAtom);
  const setCurrentDate = useSetAtom(currentDateAtom);
  const setSidebarLeftViewSelection = useSetAtom(sidebarLeftViewSelectionAtom);

  // The standalone desktop popup has its own query cache and no realtime sync.
  // Refresh session + tasks when Search Tasks opens and whenever the window
  // regains focus so popup results track the main app more closely.
  useEffect(() => {
    let cancelled = false;

    const refreshSearchData = async () => {
      await sessionQuery.refetch();
      if (cancelled) {
        return;
      }
      await tasksQuery.refetch();
    };

    refreshSearchData();

    const handleFocus = () => {
      refreshSearchData();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, [sessionQuery.refetch, tasksQuery.refetch]);

  // Filter tasks: exclude completed, exclude recurring, match search query
  const filteredTasks = useMemo(() => {
    if (!tasks) {
      return [];
    }

    // Base filters: exclude completed and recurring tasks
    const searchable = tasks.filter(
      (task: TaskSelectDecoded) =>
        task.status !== "done" && task.seriesMasterId === null
    );

    // If no search query, return all searchable tasks
    if (!search.trim()) {
      return searchable;
    }

    // Filter by title match
    const query = search.trim().toLowerCase();
    return searchable.filter((task: TaskSelectDecoded) =>
      task.title.toLowerCase().includes(query) ||
      task.description?.toLowerCase().includes(query)
    );
  }, [tasks, search]);

  // Handle task selection: navigate to task and open edit popover
  const handleSelectTask = useCallback(
    async (task: TaskSelectDecoded) => {
      const destination = resolveTaskSearchDestination(task, {
        today,
        now,
        timeZone,
      });

      const request =
        destination.kind === "unmapped"
          ? {
              requestId: uuidv7(),
              taskId: task.id,
              target: "sidebar" as const,
            }
          : createCommandBarTaskOpenRequest({
              destination,
              taskId: task.id,
            });

      if (selectionMode === "desktop-popup" && isTauriRuntime()) {
        const { emit } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");

        await emit(
          COMMAND_BAR_TASK_OPEN_EVENT,
          serializeCommandBarTaskOpenRequest(request)
        );
        await invoke("focus_main_window_for_command_bar_selection");
        return;
      }

      applyCommandBarTaskOpenRequest(request, {
        setCommandBarTaskOpenRequest,
        setCurrentDate,
        setSidebarLeftViewSelection,
      });

      // Close the command bar
      setCommandBarOpen(false);
    },
    [
      now,
      selectionMode,
      setCommandBarOpen,
      setCommandBarTaskOpenRequest,
      setCurrentDate,
      setSidebarLeftViewSelection,
      timeZone,
      today,
    ]
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
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <CalendarIcon className="size-3.5" />
                {task.startDate &&
                  formatPlainDate(task.startDate, {
                    month: "short",
                    day: "numeric",
                  })}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <InboxIcon className="size-3.5" />
                Inbox
              </span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
