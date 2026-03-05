"use client";

import type { TagSelect } from "@kompose/api/routers/tag/contract";
import type {
  ClientTaskInsertDecoded,
  LinkMeta,
} from "@kompose/api/routers/task/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { dedupeLinks, getProviderLabel } from "@kompose/state/link-meta-utils";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  Link2Icon,
  Loader2Icon,
  PlayCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Fallback title when no typed title and no metadata */
function fallbackTitle(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

/** Build task data from parsed input and resolved link metadata */
function buildTaskDataFromParsed(
  parsed: ParsedTaskInput,
  linkMetaMap: Record<string, LinkMeta>,
  firstLinkMeta: LinkMeta | undefined,
  matchedTagIds: string[]
): ClientTaskInsertDecoded {
  const links = dedupeLinks(
    parsed.links.map((url) => {
      if (linkMetaMap[url]) {
        return linkMetaMap[url];
      }
      return {
        provider: "unknown" as const,
        url,
        fetchedAt: new Date().toISOString(),
      };
    })
  );

  let title = parsed.title;
  let durationMinutes = parsed.durationMinutes ?? 30;

  if (firstLinkMeta) {
    if (!title && firstLinkMeta.title) {
      title = firstLinkMeta.title;
    }
    if (
      !parsed.durationMinutes &&
      "durationSeconds" in firstLinkMeta &&
      firstLinkMeta.durationSeconds > 0
    ) {
      durationMinutes = Math.ceil(firstLinkMeta.durationSeconds / 60);
    }
  }

  if (!title && parsed.links.length > 0) {
    title = fallbackTitle(parsed.links[0]);
  }

  return {
    title,
    durationMinutes,
    dueDate: parsed.dueDate ?? undefined,
    startDate: parsed.startDate ?? undefined,
    links,
    tagIds: matchedTagIds.length > 0 ? matchedTagIds : undefined,
  };
}

interface CommandBarCreateTaskProps {
  /** Callback when a task is successfully created (to clear/reset input) */
  onCreated: () => void;
  /** Callback to update the search input */
  onUpdateSearch: (next: string) => void;
  search: string;
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
  const { createTask, parseLink } = useTasks();
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];

  // Parse the input into structured task data
  const parsed: ParsedTaskInput = useMemo(
    () => parseTaskInput(search),
    [search]
  );

  // Links alone are enough to create a task — the title will come from metadata
  const isValid = parsed.title.length > 0 || parsed.links.length > 0;

  // Track parsed metadata for each URL, keyed by URL string
  const [linkMetaMap, setLinkMetaMap] = useState<Record<string, LinkMeta>>({});
  const [pendingUrls, setPendingUrls] = useState<Set<string>>(new Set());
  const lastParsedUrls = useRef<string[]>([]);

  const parseLinkMutate = parseLink.mutate;

  // Fire parse requests for any newly detected URLs
  const dispatchParses = useCallback(
    (urls: string[]) => {
      const previous = lastParsedUrls.current;
      const newUrls = urls.filter((url) => !previous.includes(url));
      lastParsedUrls.current = urls;

      for (const url of newUrls) {
        setPendingUrls((prev) => new Set([...prev, url]));
        parseLinkMutate(url, {
          onSuccess: (meta) => {
            setLinkMetaMap((prev) => ({ ...prev, [url]: meta }));
            setPendingUrls((prev) => {
              const next = new Set(prev);
              next.delete(url);
              return next;
            });
          },
          onError: () => {
            setPendingUrls((prev) => {
              const next = new Set(prev);
              next.delete(url);
              return next;
            });
          },
        });
      }

      if (urls.length === 0 && previous.length > 0) {
        lastParsedUrls.current = [];
        setLinkMetaMap({});
        setPendingUrls(new Set());
      }
    },
    [parseLinkMutate]
  );

  // Debounce URL parsing so partial URLs typed mid-keystroke don't trigger
  // backend calls — only fire once the URL token stabilises (500ms idle).
  // The timer resets on every keystroke; dispatchParses internally skips
  // URLs that have already been parsed.
  useEffect(() => {
    const urls = parsed.links;
    const timer = setTimeout(() => {
      dispatchParses(urls);
    }, 500);
    return () => clearTimeout(timer);
  }, [parsed.links, dispatchParses]);

  // First link's metadata is used for auto-fill
  const firstLinkMeta =
    parsed.links.length > 0 ? linkMetaMap[parsed.links[0]] : undefined;

  const tagQuery = useMemo(() => {
    const match = TAG_QUERY_PATTERN.exec(search);
    if (!match) {
      return null;
    }
    const raw = match[1];
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

    const taskData = buildTaskDataFromParsed(
      parsed,
      linkMetaMap,
      firstLinkMeta,
      matchedTagIds
    );

    createTask.mutate(taskData, { onSuccess: () => onCreated() });
  };

  // Effective duration for display — explicit input takes priority
  const effectiveDuration =
    parsed.durationMinutes ??
    (firstLinkMeta &&
    "durationSeconds" in firstLinkMeta &&
    firstLinkMeta.durationSeconds > 0
      ? Math.ceil(firstLinkMeta.durationSeconds / 60)
      : null);

  return (
    <>
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

      {isValid && (
        <>
          <CommandGroup heading="Create Task">
            <CommandItem
              onSelect={() => handleCreateRef.current()}
              value={parsed.title}
            >
              <CheckIcon className="text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">
                  {parsed.title || firstLinkMeta?.title || "New task from link"}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {effectiveDuration !== null && (
                    <Badge
                      className="h-6 gap-1.5 px-2 text-[11px]"
                      variant="secondary"
                    >
                      <ClockIcon className="size-3.5" />
                      {formatDuration(effectiveDuration)}
                    </Badge>
                  )}

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

                  {/* Link badges — one per detected URL */}
                  {parsed.links.map((url) => {
                    const meta = linkMetaMap[url];
                    const isPending = pendingUrls.has(url);
                    return (
                      <Badge
                        className="h-6 gap-1.5 px-2 text-[11px]"
                        key={url}
                        variant="secondary"
                      >
                        {isPending ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <Link2Icon className="size-3.5" />
                        )}
                        {meta ? getProviderLabel(meta.provider) : "Link"}
                      </Badge>
                    );
                  })}

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
