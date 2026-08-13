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
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  createCommandBarTaskOpenRequest,
  resolveTaskSearchDestination,
  serializeCommandBarTaskOpenRequest,
  type TaskSearchDestination,
} from "@kompose/state/task-search-routing";
import { useAtomValue, useSetAtom } from "jotai";
import {
  CalendarClockIcon,
  CalendarIcon,
  CircleDotIcon,
  CircleIcon,
  InboxIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import type { Temporal } from "temporal-polyfill";
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
import {
  sidebarLeftOpenAtom,
  sidebarLeftViewSelectionAtom,
} from "@/state/sidebar";

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

function TaskLocationIndicator({
  destination,
  today,
}: {
  destination: TaskSearchDestination;
  today: Temporal.PlainDate;
}) {
  if (destination.kind === "calendar") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-sm">
        <CalendarIcon className="size-3.5" />
        {formatPlainDate(destination.date, {
          day: "numeric",
          month: "short",
        })}
      </span>
    );
  }

  if (destination.kind === "sidebar" && destination.view === "today") {
    const label = destination.date
      ? formatSidebarDateLabel(destination.date, today)
      : "Today";

    return (
      <span className="flex items-center gap-1 text-muted-foreground text-sm">
        <CalendarClockIcon className="size-3.5" />
        {label}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-muted-foreground text-sm">
      <InboxIcon className="size-3.5" />
      {destination.kind === "sidebar" && destination.view === "inbox"
        ? "Inbox"
        : "Task"}
    </span>
  );
}

function TaskSearchResult({
  destination,
  onSelect,
  task,
  today,
}: {
  destination: TaskSearchDestination;
  onSelect: (task: TaskSelectDecoded) => Promise<void>;
  task: TaskSelectDecoded;
  today: Temporal.PlainDate;
}) {
  const StatusIcon = getStatusIcon(task.status);
  const handleSelect = useCallback(() => {
    onSelect(task).catch((error) => {
      console.warn("Failed to open task from command bar.", error);
    });
  }, [onSelect, task]);

  return (
    <CommandItem onSelect={handleSelect} value={`task:${task.id}`}>
      <StatusIcon className="text-muted-foreground" />
      <span className="flex-1 truncate">{task.title}</span>
      <TaskLocationIndicator destination={destination} today={today} />
    </CommandItem>
  );
}

function formatSidebarDateLabel(
  date: Temporal.PlainDate,
  today: Temporal.PlainDate
) {
  const dayOffset = today.until(date, { largestUnit: "day" }).days;

  if (dayOffset === 0) {
    return "Today";
  }
  if (dayOffset === 1) {
    return "Tomorrow";
  }
  if (dayOffset === -1) {
    return "Yesterday";
  }

  return formatPlainDate(date, {
    day: "numeric",
    month: "short",
  });
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
  const { tasksQuery } = useTasks({
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const { data: tasks, isLoading } = tasksQuery;
  const today = useAtomValue(todayPlainDateAtom);
  const now = useAtomValue(nowZonedDateTimeAtom);
  const timeZone = useAtomValue(timezoneAtom);

  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);
  const setCommandBarTaskOpenRequest = useSetAtom(
    commandBarTaskOpenRequestAtom
  );
  const setCurrentDate = useSetAtom(currentDateAtom);
  const setSidebarLeftOpen = useSetAtom(sidebarLeftOpenAtom);
  const setSidebarLeftViewSelection = useSetAtom(sidebarLeftViewSelectionAtom);

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
    return searchable.filter(
      (task: TaskSelectDecoded) =>
        task.title.toLowerCase().includes(query) ||
        task.description?.toLowerCase().includes(query)
    );
  }, [tasks, search]);

  // Handle task selection: navigate to task and open edit popover
  const handleSelectTask = useCallback(
    async (task: TaskSelectDecoded) => {
      const destination = resolveTaskSearchDestination(task, {
        now,
        timeZone,
        today,
      });

      const request =
        destination.kind === "unmapped"
          ? {
              requestId: uuidv7(),
              target: "sidebar" as const,
              taskId: task.id,
            }
          : createCommandBarTaskOpenRequest({
              destination,
              taskId: task.id,
            });

      if (selectionMode === "desktop-popup" && isTauriRuntime()) {
        const [{ emit }, { invoke }] = await Promise.all([
          import("@tauri-apps/api/event"),
          import("@tauri-apps/api/core"),
        ]);

        await Promise.all([
          emit(
            COMMAND_BAR_TASK_OPEN_EVENT,
            serializeCommandBarTaskOpenRequest(request)
          ),
          invoke("focus_main_window_for_command_bar_selection"),
        ]);
        return;
      }

      applyCommandBarTaskOpenRequest(request, {
        setCommandBarTaskOpenRequest,
        setCurrentDate,
        setSidebarLeftOpen,
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
      setSidebarLeftOpen,
      setSidebarLeftViewSelection,
      timeZone,
      today,
    ]
  );

  if (isLoading) {
    return <CommandEmpty>Loading tasks…</CommandEmpty>;
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
        const destination = resolveTaskSearchDestination(task, {
          now,
          timeZone,
          today,
        });

        return (
          <TaskSearchResult
            destination={destination}
            key={task.id}
            onSelect={handleSelectTask}
            task={task}
            today={today}
          />
        );
      })}
    </CommandGroup>
  );
}
