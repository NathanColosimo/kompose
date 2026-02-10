"use client";

import type { TagSelect } from "@kompose/api/routers/tag/contract";
import type { ClientTaskInsertDecoded } from "@kompose/api/routers/task/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PlayCircleIcon,
} from "lucide-react";
import { useMemo, useRef } from "react";
import { tagIconMap } from "@/components/tags/tag-icon-map";
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

const TAG_QUERY_PATTERN = /#([^=~>#]*)$/;

interface CommandBarCreateTaskProps {
  search: string;
  /** Callback when a task is successfully created (to clear/reset input) */
  onCreated: () => void;
  /** Callback to update the search input */
  onUpdateSearch: (next: string) => void;
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
  onCreated,
  onUpdateSearch,
}: CommandBarCreateTaskProps) {
  const { createTask } = useTasks();
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];

  // Parse the input into structured task data
  const parsed: ParsedTaskInput = useMemo(
    () => parseTaskInput(search),
    [search]
  );

  // Check if the parsed input is valid for creation
  const isValid = parsed.title.length > 0;

  const tagQuery = useMemo(() => {
    const match = TAG_QUERY_PATTERN.exec(search);
    if (!match) {
      return null;
    }
    const raw = match[1];
    // Trailing space means the tag was confirmed/selected — close dropdown
    if (raw.endsWith(" ")) {
      return null;
    }
    return raw.trim();
  }, [search]);

  const matchingTags = useMemo(() => {
    if (tagQuery === null) {
      return [];
    }
    if (!tagQuery) {
      return tags;
    }
    const lowered = tagQuery.toLowerCase();
    return tags.filter((tag) => tag.name.toLowerCase().includes(lowered));
  }, [tagQuery, tags]);

  const handleTagSelect = (tag: TagSelect) => {
    const match = TAG_QUERY_PATTERN.exec(search);
    if (!match) {
      return;
    }
    const prefix = search.slice(0, match.index);
    onUpdateSearch(`${prefix}#${tag.name} `);
  };

  // Ref to always have the latest create handler without re-registering
  const handleCreateRef = useRef<() => void>(() => {
    return;
  });

  // Update ref to latest closure (no dependencies needed, runs every render)
  handleCreateRef.current = () => {
    if (!isValid || createTask.isPending) {
      return;
    }

    const matchedTagIds = Array.from(
      new Set(
        parsed.tagNames
          .map((name) => tags.find((tag) => tag.name === name)?.id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const taskData: ClientTaskInsertDecoded = {
      title: parsed.title,
      durationMinutes: parsed.durationMinutes ?? 30,
      dueDate: parsed.dueDate ?? undefined,
      startDate: parsed.startDate ?? undefined,
      // No startTime - user can schedule later by dragging to calendar
      tagIds: matchedTagIds.length > 0 ? matchedTagIds : undefined,
    };

    createTask.mutate(taskData, {
      onSuccess: () => {
        // Clear input and stay in create mode for quick successive creation
        onCreated();
      },
    });
  };

  return (
    <>
      {/* Show empty state when no valid title */}
      {!isValid && matchingTags.length === 0 && (
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
              <span>
                <code className="rounded bg-muted px-1">#</code> tag
              </span>
            </div>
          </div>
        </CommandEmpty>
      )}

      {matchingTags.length > 0 && (
        <CommandGroup heading="Tags">
          {matchingTags.map((tag) => {
            const Icon = tagIconMap[tag.icon];
            return (
              <CommandItem
                key={tag.id}
                onSelect={() => handleTagSelect(tag)}
                value={tag.name}
              >
                <Icon className="text-muted-foreground" />
                <span>{tag.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
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

                  {/* Tag badges */}
                  {parsed.tagNames.map((name) => {
                    const tag = tags.find((t) => t.name === name);
                    if (!tag) {
                      return null;
                    }
                    const Icon = tagIconMap[tag.icon];
                    return (
                      <Badge
                        className="h-6 gap-1.5 px-2 text-[11px]"
                        key={tag.id}
                        variant="secondary"
                      >
                        <Icon className="size-3.5" />
                        {tag.name}
                      </Badge>
                    );
                  })}
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
            <span>
              <code className="rounded bg-muted px-1">#</code> tag
            </span>
          </div>
        </>
      )}
    </>
  );
}
