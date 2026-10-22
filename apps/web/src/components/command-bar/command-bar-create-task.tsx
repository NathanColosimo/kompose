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
  SparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Temporal } from "temporal-polyfill";
import { tagIconMap } from "@/components/tags/tag-icon-map";
import { Badge } from "@/components/ui/badge";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import type { SmartTaskInput } from "@/lib/smart-task-input";
import {
  formatDuration,
  type ParsedTaskInput,
  parseTaskInput,
} from "@/lib/task-input-parser";
import { formatPlainDate } from "@/lib/temporal-utils";
import { useSmartTaskInput } from "@/lib/use-smart-task-input";

const TAG_QUERY_PATTERN = /#([^=~>#]*)$/;
const EMPTY_TAGS: TagSelect[] = [];

/** Fallback title when no typed title and no metadata */
function fallbackTitle(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

/** True when the input uses any explicit token (=, >, ~, #). */
function hasExplicitTokens(parsed: ParsedTaskInput) {
  return (
    parsed.durationRaw !== null ||
    parsed.dueDateRaw !== null ||
    parsed.startDateRaw !== null ||
    parsed.tagNamesRaw.length > 0
  );
}

/** Fill fields from on-device parsing; only used when no tokens were typed. */
function withSmartInput(
  parsed: ParsedTaskInput,
  smart: SmartTaskInput | null
): ParsedTaskInput {
  if (!smart) {
    return parsed;
  }
  return {
    ...parsed,
    dueDate: smart.dueDate,
    durationMinutes: smart.durationMinutes,
    startDate: smart.startDate,
    startTime: smart.startTime,
    tagNames: smart.tagNames,
    title: smart.title,
  };
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
        fetchedAt: new Date().toISOString(),
        provider: "unknown" as const,
        url,
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
    dueDate: parsed.dueDate ?? undefined,
    durationMinutes,
    links,
    startDate: parsed.startDate ?? undefined,
    startTime: parsed.startTime ?? undefined,
    tagIds: matchedTagIds.length > 0 ? matchedTagIds : undefined,
    title,
  };
}

/** Marks a preview filled (or being filled) by the on-device model. */
function OnDeviceBadge({
  parsed,
  pending,
}: {
  parsed: boolean;
  pending: boolean;
}) {
  if (!(parsed || pending)) {
    return null;
  }
  return (
    <Badge
      className="h-6 gap-1.5 px-2 text-[11px]"
      title="Parsed on this device"
      variant="secondary"
    >
      {pending ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <SparklesIcon className="size-3.5" />
      )}
      On-device
    </Badge>
  );
}

function StartBadge({
  date,
  time,
}: {
  date: Temporal.PlainDate;
  time: Temporal.PlainTime | null;
}) {
  return (
    <Badge className="h-6 gap-1.5 px-2 text-[11px]" variant="secondary">
      <PlayCircleIcon className="size-3.5" />
      {formatPlainDate(date, { day: "numeric", month: "short" })}
      {time &&
        ` ${time.toLocaleString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}`}
    </Badge>
  );
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
  const tags = tagsQuery.data ?? EMPTY_TAGS;

  // Parse the input into structured task data
  const typed: ParsedTaskInput = useMemo(
    () => parseTaskInput(search),
    [search]
  );

  // Free-form input (no tokens) also goes to the on-device model, when the
  // browser has one. Its result replaces the preview once it arrives.
  const tagNames = useMemo(() => tags.map((tag) => tag.name), [tags]);
  const smartInput = useSmartTaskInput(
    hasExplicitTokens(typed) || typed.title.length < 3 ? null : typed.title,
    tagNames
  );
  const parsed = withSmartInput(typed, smartInput.result);
  const [resolving, setResolving] = useState(false);

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
      const previousUrls = new Set(previous);
      const newUrls = urls.filter((url) => !previousUrls.has(url));
      lastParsedUrls.current = urls;

      for (const url of newUrls) {
        setPendingUrls((prev) => new Set([...prev, url]));
        parseLinkMutate(url, {
          onError: () => {
            setPendingUrls((prev) => {
              const next = new Set(prev);
              next.delete(url);
              return next;
            });
          },
          onSuccess: (meta) => {
            setLinkMetaMap((prev) => ({ ...prev, [url]: meta }));
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

  const handleCreate = async () => {
    if (!isValid || createTask.isPending || resolving) {
      return;
    }

    // Enter can beat the debounced parse; wait briefly for the model.
    let input = parsed;
    if (smartInput.pending) {
      setResolving(true);
      input = withSmartInput(typed, await smartInput.resolve());
      setResolving(false);
    }

    const matchedTagIds = Array.from(
      new Set(
        input.tagNames.flatMap((name) => {
          const id = tags.find((tag) => tag.name === name)?.id;
          return id ? [id] : [];
        })
      )
    );

    const taskData = buildTaskDataFromParsed(
      input,
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

  // Keep the rendered label free to update from link metadata.
  const createItemLabel =
    parsed.title ||
    firstLinkMeta?.title ||
    (parsed.links[0] ? fallbackTitle(parsed.links[0]) : "New task from link");

  // Keep the command item value stable across async link parsing so cmdk does
  // not drop selection when the preview label changes after metadata resolves.
  const createItemValue = typed.title || typed.links.join(" ") || "create-task";

  return (
    <>
      {!isValid && matchingTags.length === 0 && (
        <CommandEmpty>
          <div className="space-y-2">
            <p>Type a task title to create…</p>
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
            <CommandItem onSelect={handleCreate} value={createItemValue}>
              <CheckIcon className="text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">{createItemLabel}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <OnDeviceBadge
                    parsed={smartInput.result !== null}
                    pending={smartInput.pending || resolving}
                  />

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
                        day: "numeric",
                        month: "short",
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
                    <StartBadge
                      date={parsed.startDate}
                      time={parsed.startTime}
                    />
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
