"use client";

import type { TagSelect } from "@kompose/api/routers/tag/contract";
import type {
  ClientTaskInsertDecoded,
  LinkMeta,
} from "@kompose/api/routers/task/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { dedupeLinks, getProviderLabel } from "@kompose/state/link-meta-utils";
import { getTaskRecurrenceDisplayText } from "@kompose/state/task-recurrence";
import type { TaskFields } from "@kompose/task-parser/fields";
import type { ParsedTask } from "@kompose/task-parser/parser";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  Link2Icon,
  Loader2Icon,
  PlayCircleIcon,
  RepeatIcon,
  SparklesIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { Temporal } from "temporal-polyfill";
import { tagIconMap } from "@/components/tags/tag-icon-map";
import { Badge } from "@/components/ui/badge";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { formatDuration, formatPlainDate } from "@/lib/temporal-utils";
import { type MagicParse, useMagicTask } from "@/lib/use-magic-task";
import { cn } from "@/lib/utils";

const TAG_QUERY_PATTERN = /#([^#]*)$/;
const URL_PATTERN = /https?:\/\/\S+/g;
const EMPTY_TAGS: TagSelect[] = [];

/** Fallback title when no typed title and no metadata */
function fallbackTitle(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

/** What the create item shows and creates. */
interface TaskDraft extends TaskFields {
  tagNames: string[];
}

/** The model's parse, or the plain text (links apart) until there is one. */
function draft(text: string, task: ParsedTask | null): TaskDraft {
  if (task) {
    return { ...task, tagNames: task.tags.map((tag) => tag.name) };
  }
  return {
    description: null,
    dueDate: null,
    durationMinutes: null,
    links: text.match(URL_PATTERN) ?? [],
    recurrence: null,
    startDate: null,
    startTime: null,
    tagNames: [],
    title: text.replace(URL_PATTERN, "").trim(),
  };
}

/** A linked video's length in minutes, if its metadata has one. */
function linkDurationMinutes(meta: LinkMeta | undefined): number | null {
  if (meta && "durationSeconds" in meta && meta.durationSeconds > 0) {
    return Math.ceil(meta.durationSeconds / 60);
  }
  return null;
}

/** Build task data from parsed input and resolved link metadata */
function buildTaskDataFromParsed(
  parsed: TaskDraft,
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

  let title = parsed.title || firstLinkMeta?.title || "";
  let durationMinutes = parsed.durationMinutes ?? 30;
  const linkMinutes = linkDurationMinutes(firstLinkMeta);
  if (!parsed.durationMinutes && linkMinutes !== null) {
    durationMinutes = linkMinutes;
  }

  if (!title && parsed.links.length > 0) {
    title = fallbackTitle(parsed.links[0]);
  }

  return {
    description: parsed.description ?? undefined,
    dueDate: parsed.dueDate ?? undefined,
    durationMinutes,
    links,
    recurrence: parsed.recurrence ?? undefined,
    startDate: parsed.startDate ?? undefined,
    startTime: parsed.startTime ?? undefined,
    tagIds: matchedTagIds.length > 0 ? matchedTagIds : undefined,
    title,
  };
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  weekday: "short",
};
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

function PreviewBadge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      className={cn("h-6 gap-1.5 px-2 font-normal text-[11px]", className)}
      variant="secondary"
    >
      {children}
    </Badge>
  );
}

/** Label for a start date, with the time when one was given. */
function startLabel(date: Temporal.PlainDate, time: Temporal.PlainTime | null) {
  const day = formatPlainDate(date, DATE_FORMAT);
  return time ? `${day} · ${time.toLocaleString(undefined, TIME_FORMAT)}` : day;
}

/**
 * Shows that the on-device model filled (or is filling) the preview. Sits at
 * the end of the row so the badges don't shift when it appears.
 */
function OnDeviceStatus({
  parse,
  resolving,
}: {
  parse: MagicParse;
  resolving: boolean;
}) {
  const reading = resolving || parse.status === "reading";
  if (!(reading || parse.status === "done")) {
    return null;
  }
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-1 self-start text-[11px] text-muted-foreground"
      title="Read by a model on this device; nothing leaves it."
    >
      {reading ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <SparklesIcon className="size-3" />
      )}
      {reading ? "Reading…" : "On-device"}
    </span>
  );
}

/** Model-filled fields fade in, and dim while a newer request replaces them. */
function smartFieldClassName(parse: MagicParse) {
  if (parse.status === "done") {
    return "fade-in-0 animate-in transition-opacity duration-150";
  }
  if (parse.status === "reading" && parse.task) {
    return "opacity-50 transition-opacity duration-150";
  }
}

interface CommandBarCreateTaskProps {
  /** Callback when a task is successfully created (to clear/reset input) */
  onCreated: () => void;
  /** Callback to update the search input */
  onUpdateSearch: (next: string) => void;
  search: string;
}

/**
 * CommandBarCreateTask - Create task sub-view.
 *
 * The on-device model (useMagicTask) reads the title, dates, duration,
 * repeat, links, description and tags from free text ("call mom tomorrow
 * at 4 for 30m #family"); typing # suggests the user's tags. Shows a live
 * preview and creates the task on Enter.
 */
export function CommandBarCreateTask({
  search,
  onCreated,
  onUpdateSearch,
}: CommandBarCreateTaskProps) {
  const { createTask, parseLink } = useTasks();
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? EMPTY_TAGS;

  const tagOptions = useMemo(
    () => tags.map((tag) => ({ id: tag.id, name: tag.name })),
    [tags]
  );
  const text = search.trim();
  const magic = useMagicTask(text, tagOptions);
  const parsed = draft(text, magic.parse.task);
  const smartClassName = smartFieldClassName(magic.parse);
  const [resolving, startResolving] = useTransition();

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

  const createFrom = (input: TaskDraft) => {
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

  const handleCreate = () => {
    if (!isValid || createTask.isPending || resolving) {
      return;
    }
    if (magic.parse.status === "done") {
      createFrom(parsed);
      return;
    }
    // Enter can beat the parse (or the model download); wait for it.
    startResolving(async () => {
      createFrom(draft(text, await magic.resolve()));
    });
  };

  // Duration for display; a parsed one takes priority over the link's
  const effectiveDuration =
    parsed.durationMinutes ?? linkDurationMinutes(firstLinkMeta);

  // Keep the rendered label free to update from link metadata.
  const createItemLabel =
    parsed.title ||
    firstLinkMeta?.title ||
    (parsed.links[0] ? fallbackTitle(parsed.links[0]) : "New task from link");

  // Keep the command item value stable across async parsing so cmdk does not
  // drop selection when the preview label changes.
  const createItemValue = text || "create-task";

  return (
    <>
      {!isValid && matchingTags.length === 0 && (
        <CommandEmpty>
          Describe a task, like “call mom tomorrow at 4 for 30m #family”
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
        <CommandGroup heading="Create Task">
          <CommandItem onSelect={handleCreate} value={createItemValue}>
            <CheckIcon className="text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{createItemLabel}</span>
                <OnDeviceStatus parse={magic.parse} resolving={resolving} />
              </div>
              {parsed.description && (
                <span
                  className={cn(
                    "line-clamp-2 text-muted-foreground text-xs",
                    smartClassName
                  )}
                >
                  {parsed.description}
                </span>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {parsed.startDate && (
                  <PreviewBadge className={smartClassName}>
                    <PlayCircleIcon className="size-3.5" />
                    {startLabel(parsed.startDate, parsed.startTime)}
                  </PreviewBadge>
                )}

                {parsed.recurrence && (
                  <PreviewBadge className={smartClassName}>
                    <RepeatIcon className="size-3.5" />
                    {getTaskRecurrenceDisplayText(parsed.recurrence)}
                  </PreviewBadge>
                )}

                {parsed.dueDate && (
                  <PreviewBadge className={smartClassName}>
                    <CalendarIcon className="size-3.5" />
                    Due {formatPlainDate(parsed.dueDate, DATE_FORMAT)}
                  </PreviewBadge>
                )}

                {effectiveDuration !== null && (
                  <PreviewBadge className={smartClassName}>
                    <ClockIcon className="size-3.5" />
                    {formatDuration(effectiveDuration)}
                  </PreviewBadge>
                )}

                {/* Link badges — one per detected URL */}
                {parsed.links.map((url) => {
                  const meta = linkMetaMap[url];
                  return (
                    <PreviewBadge key={url}>
                      {pendingUrls.has(url) ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <Link2Icon className="size-3.5" />
                      )}
                      {meta ? getProviderLabel(meta.provider) : "Link"}
                    </PreviewBadge>
                  );
                })}

                {parsed.tagNames.map((name) => {
                  const tag = tags.find((t) => t.name === name);
                  if (!tag) {
                    return null;
                  }
                  const Icon = tagIconMap[tag.icon];
                  return (
                    <PreviewBadge className={smartClassName} key={tag.id}>
                      <Icon className="size-3.5" />
                      {tag.name}
                    </PreviewBadge>
                  );
                })}
              </div>
            </div>
          </CommandItem>
        </CommandGroup>
      )}
    </>
  );
}
