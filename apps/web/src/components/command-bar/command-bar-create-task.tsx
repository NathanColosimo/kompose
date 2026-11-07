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
import { formatDuration } from "@kompose/state/temporal-utils";
import type { TaskFields } from "@kompose/task-parser/fields";
import type { ParsedTask, TagOption } from "@kompose/task-parser/parser";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  Link2Icon,
  Loader2Icon,
  PlayCircleIcon,
  RepeatIcon,
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
import { formatPlainDate } from "@/lib/temporal-utils";
import { type MagicParse, useMagicTask } from "@/lib/use-magic-task";
import { cn } from "@/lib/utils";

const TAG_QUERY_PATTERN = /#([^#]*)$/;
const URL_PATTERN = /https?:\/\/\S+/g;
const EMPTY_TAGS: TagSelect[] = [];

function fallbackTitle(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

interface TaskDraft extends TaskFields {
  tags: TagOption[];
}

/** The model's parse, or the plain text (links apart) until there is one. */
function draft(text: string, task: ParsedTask | null): TaskDraft {
  if (task) {
    return task;
  }
  return {
    description: null,
    dueDate: null,
    durationMinutes: null,
    links: text.match(URL_PATTERN) ?? [],
    recurrence: null,
    startDate: null,
    startTime: null,
    tags: [],
    title: text.replace(URL_PATTERN, "").trim(),
  };
}

/** Round link media durations up to whole minutes. */
function linkDurationMinutes(meta: LinkMeta | undefined): number | null {
  if (meta && "durationSeconds" in meta && meta.durationSeconds > 0) {
    return Math.ceil(meta.durationSeconds / 60);
  }
  return null;
}

function buildTaskDataFromParsed(
  parsed: TaskDraft,
  linkMetaMap: Record<string, LinkMeta>,
  firstLinkMeta: LinkMeta | undefined
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
    tagIds:
      parsed.tags.length > 0 ? parsed.tags.map((tag) => tag.id) : undefined,
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

function startLabel(date: Temporal.PlainDate, time: Temporal.PlainTime | null) {
  const day = formatPlainDate(date, DATE_FORMAT);
  return time ? `${day} · ${time.toLocaleString(undefined, TIME_FORMAT)}` : day;
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
  onCreated: () => void;
  onUpdateSearch: (next: string) => void;
  search: string;
}

/** See documents/command-bar.md for parsing, link enrichment, and submit behavior. */
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

  const [linkMetaMap, setLinkMetaMap] = useState<Record<string, LinkMeta>>({});
  const [pendingUrls, setPendingUrls] = useState<Set<string>>(new Set());
  const lastParsedUrls = useRef<string[]>([]);

  const parseLinkMutate = parseLink.mutate;

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

  // Wait for 500ms idle so partially typed URLs do not trigger backend calls.
  useEffect(() => {
    const urls = parsed.links;
    const timer = setTimeout(() => {
      dispatchParses(urls);
    }, 500);
    return () => clearTimeout(timer);
  }, [parsed.links, dispatchParses]);

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
    const taskData = buildTaskDataFromParsed(input, linkMetaMap, firstLinkMeta);
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

  const effectiveDuration =
    parsed.durationMinutes ?? linkDurationMinutes(firstLinkMeta);

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
        <CommandGroup heading="Create task">
          <CommandItem onSelect={handleCreate} value={createItemValue}>
            <CheckIcon className="text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{createItemLabel}</span>
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

                {parsed.tags.map(({ id }) => {
                  const tag = tags.find((t) => t.id === id);
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
