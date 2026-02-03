"use client";

import type { ClientTaskInsertDecoded } from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PlayCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  formatDuration,
  type ParsedTaskInput,
  parseTaskInput,
} from "@/lib/task-input-parser";
import { formatPlainDate } from "@/lib/temporal-utils";

interface CommandBarCreateTaskProps {
  search: string;
  /** Callback to register the submit function with the parent */
  onRegisterSubmit: (fn: () => void) => void;
  /** Callback when a task is successfully created (to clear/reset input) */
  onCreated: () => void;
}

/**
 * CommandBarCreateTask - Create task sub-view with NLP input parsing.
 *
 * Parses input using special syntax:
 * - Title: text before any special tokens
 * - =duration: task duration (e.g., =2h, =30m)
 * - >date: due date (e.g., >monday, >tomorrow)
 * - ~date: start date (e.g., ~friday, ~next week)
 *
 * Shows a live preview and creates the task on Enter.
 */
export function CommandBarCreateTask({
  search,
  onRegisterSubmit,
  onCreated,
}: CommandBarCreateTaskProps) {
  const { createTask } = useTasks();

  // Parse the input into structured task data
  const parsed: ParsedTaskInput = useMemo(
    () => parseTaskInput(search),
    [search]
  );

  // Check if the parsed input is valid for creation
  const isValid = parsed.title.length > 0;

  // Ref to always have the latest create handler without re-registering
  const handleCreateRef = useRef<() => void>(() => {
    return;
  });

  // Update ref to latest closure (no dependencies needed, runs every render)
  handleCreateRef.current = () => {
    if (!isValid || createTask.isPending) {
      return;
    }

    const taskData: ClientTaskInsertDecoded = {
      title: parsed.title,
      durationMinutes: parsed.durationMinutes ?? 30,
      dueDate: parsed.dueDate ?? undefined,
      startDate: parsed.startDate ?? undefined,
      // No startTime - user can schedule later by dragging to calendar
    };

    createTask.mutate(taskData, {
      onSuccess: () => {
        // Clear input and stay in create mode for quick successive creation
        onCreated();
      },
    });
  };

  // Register a stable wrapper once on mount
  useEffect(() => {
    onRegisterSubmit(() => handleCreateRef.current());
  }, [onRegisterSubmit]);

  return (
    <>
      {/* Show empty state when no valid title */}
      {!isValid && (
        <CommandEmpty>
          <div className="space-y-2">
            <p>Type a task title to create...</p>
            <div className="flex justify-center gap-2 text-muted-foreground">
              <span>
                <code className="rounded bg-muted px-1">=</code> duration
              </span>
              <span>
                <code className="rounded bg-muted px-1">&gt;</code> due
              </span>
              <span>
                <code className="rounded bg-muted px-1">~</code> start
              </span>
            </div>
          </div>
        </CommandEmpty>
      )}

      {/* Show selectable create item when valid */}
      {isValid && (
        <>
          <CommandGroup heading="Create Task">
            <CommandItem
              onSelect={() => handleCreateRef.current()}
              value={parsed.title}
            >
              <CheckIcon className="text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">{parsed.title}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Duration badge */}
                  {parsed.durationMinutes && (
                    <Badge
                      className="h-6 gap-1.5 px-2 text-[11px]"
                      variant="secondary"
                    >
                      <ClockIcon className="size-3.5" />
                      {formatDuration(parsed.durationMinutes)}
                    </Badge>
                  )}

                  {/* Due date badge */}
                  {parsed.dueDate && (
                    <Badge
                      className="h-6 gap-1.5 px-2 text-[11px]"
                      variant="secondary"
                    >
                      <CalendarIcon className="size-3.5" />
                      {formatPlainDate(parsed.dueDate, {
                        month: "short",
                        day: "numeric",
                      })}
                    </Badge>
                  )}

                  {/* Start date badge */}
                  {parsed.startDate && (
                    <Badge
                      className="h-6 gap-1.5 px-2 text-[11px]"
                      variant="secondary"
                    >
                      <PlayCircleIcon className="size-3.5" />
                      {formatPlainDate(parsed.startDate, {
                        month: "short",
                        day: "numeric",
                      })}
                    </Badge>
                  )}
                </div>
              </div>
            </CommandItem>
          </CommandGroup>

          {/* Keybind hints footer */}
          <div className="flex justify-center gap-3 border-t px-3 py-2.5 text-muted-foreground text-sm">
            <span>
              <code className="rounded bg-muted px-1">=</code> duration
            </span>
            <span>
              <code className="rounded bg-muted px-1">&gt;</code> due
            </span>
            <span>
              <code className="rounded bg-muted px-1">~</code> start
            </span>
          </div>
        </>
      )}
    </>
  );
}
