"use client";

import { useDroppable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  currentDateAtom,
  todayPlainDateAtom,
} from "@kompose/state/atoms/current-date";
import { useTagTaskSections } from "@kompose/state/hooks/use-tag-task-sections";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTaskSections } from "@kompose/state/hooks/use-task-sections";
import { useAtom, useAtomValue } from "jotai";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, Inbox } from "lucide-react";
import { type ComponentProps, useEffect, useMemo } from "react";
import type { Temporal } from "temporal-polyfill";
import { tagIconMap } from "@/components/tags/tag-icon-map";
import { CreateTaskForm } from "@/components/task-form/create-task-form";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { formatPlainDate } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import {
  defaultSidebarLeftViewSelection,
  type SidebarLeftBaseViewId,
  sidebarLeftViewSelectionAtom,
} from "@/state/sidebar";
import { TaskItem } from "./task-item";

export const SIDEBAR_TASK_LIST_DROPPABLE_ID = "sidebar-task-list";

interface SidebarNavItem {
  icon: LucideIcon;
  id: string;
  tagId?: string;
  title: string;
  type: "base" | "tag";
}

const navMain: SidebarNavItem[] = [
  {
    icon: Inbox,
    id: "inbox",
    title: "Inbox",
    type: "base",
  },
  {
    icon: CalendarClock,
    id: "today",
    title: "Today",
    type: "base",
  },
];

function getBaseSidebarNavItem(
  navItems: SidebarNavItem[],
  id: SidebarLeftBaseViewId
) {
  return (
    navItems.find((item) => item.type === "base" && item.id === id) ??
    navItems[0]
  );
}

function getSidebarSelectionFromNavItem(item: SidebarNavItem) {
  if (item.type === "tag" && item.tagId) {
    return { tagId: item.tagId, type: "tag" as const };
  }

  return { id: item.id as SidebarLeftBaseViewId, type: "base" as const };
}

function formatDateSidebarTitle(
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
  if (Math.abs(dayOffset) <= 6) {
    return formatPlainDate(date, { weekday: "long" });
  }

  return formatPlainDate(
    date,
    date.year === today.year
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" }
  );
}

function formatDateSidebarEmptyMessage(dateTitle: string) {
  const normalizedTitle =
    dateTitle === "Today" ||
    dateTitle === "Tomorrow" ||
    dateTitle === "Yesterday"
      ? dateTitle.toLowerCase()
      : dateTitle;

  return `Nothing for ${normalizedTitle}.`;
}

const ADD_OR_DROP_HINT =
  "Use + above to add a task, or drag one here from the calendar.";

function renderEmptyMessage(message: string, hint = ADD_OR_DROP_HINT) {
  return (
    <div className="px-4 py-6 text-muted-foreground text-sm">
      <p>{message}</p>
      <p className="mt-1 text-xs">{hint}</p>
    </div>
  );
}

function renderSidebarLoadingContent() {
  const loadingKeys = ["one", "two", "three", "four", "five", "six"] as const;

  return (
    <div aria-hidden className="flex flex-col gap-0.5 px-2 pt-2">
      {loadingKeys.map((key) => (
        <div className="flex items-start gap-3 px-2 py-2.5" key={key}>
          <div className="mt-0.5 size-4 shrink-0 rounded-full bg-muted/60" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-3/4 rounded-sm bg-muted/60" />
            <div className="h-3 w-1/3 rounded-sm bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface TaskSection {
  label: string;
  tasks: TaskSelectDecoded[];
  tone?: "overdue";
}

function renderTaskSections(
  sections: TaskSection[],
  emptyMessage: string,
  emptyHint?: string,
  /** In a tag's own list, rows don't repeat that tag. */
  hiddenTagId?: string
) {
  const visibleSections = sections.filter(({ tasks }) => tasks.length > 0);
  if (visibleSections.length === 0) {
    return renderEmptyMessage(emptyMessage, emptyHint);
  }

  return (
    <div className="flex flex-col gap-3 px-2 pt-2 pb-4">
      {visibleSections.map(({ label, tasks, tone }) => (
        <section aria-label={label} key={label}>
          <h3
            className={cn(
              "flex items-baseline gap-1.5 px-2 pt-1 pb-1 font-medium text-xs",
              tone === "overdue" ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {label}
            <span className="font-normal tabular-nums">{tasks.length}</span>
          </h3>
          {tasks.map((task) => (
            <TaskItem hiddenTagId={hiddenTagId} key={task.id} task={task} />
          ))}
        </section>
      ))}
    </div>
  );
}

function renderInboxContent(inboxTasks: TaskSelectDecoded[]) {
  if (inboxTasks.length === 0) {
    return renderEmptyMessage("Your inbox is empty.");
  }
  return (
    <div className="flex flex-col px-2 pt-2 pb-4">
      {inboxTasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}

function renderTodayContent({
  dateTitle,
  overdueTasks,
  plannedTasks,
  doneTasks,
  unplannedTasks,
}: {
  dateTitle: string;
  overdueTasks: TaskSelectDecoded[];
  plannedTasks: TaskSelectDecoded[];
  doneTasks: TaskSelectDecoded[];
  unplannedTasks: TaskSelectDecoded[];
}) {
  return renderTaskSections(
    [
      { label: "Overdue", tasks: overdueTasks, tone: "overdue" },
      { label: "Unplanned", tasks: unplannedTasks },
      { label: "Planned", tasks: plannedTasks },
      { label: "Done", tasks: doneTasks },
    ],
    formatDateSidebarEmptyMessage(dateTitle)
  );
}

function renderTagContent({
  overdueTasks,
  tagId,
  todoTasks,
  doneTasks,
}: {
  overdueTasks: TaskSelectDecoded[];
  tagId?: string;
  todoTasks: TaskSelectDecoded[];
  doneTasks: TaskSelectDecoded[];
}) {
  return renderTaskSections(
    [
      { label: "Overdue", tasks: overdueTasks, tone: "overdue" },
      { label: "To do", tasks: todoTasks },
      { label: "Done", tasks: doneTasks },
    ],
    "No tasks with this tag yet.",
    // Dropping on a tag list unschedules a task without tagging it.
    "Use + above to add a task with this tag.",
    tagId
  );
}

function getSidebarContent({
  activeItem,
  dateTitle,
  doneTasks,
  error,
  inboxTasks,
  isLoading,
  overdueTasks,
  plannedTasks,
  tagDoneTasks,
  tagOverdueTasks,
  tagTodoTasks,
  unplannedTasks,
}: {
  activeItem: SidebarNavItem | null;
  dateTitle: string;
  doneTasks: TaskSelectDecoded[];
  error: unknown;
  inboxTasks: TaskSelectDecoded[];
  isLoading: boolean;
  overdueTasks: TaskSelectDecoded[];
  plannedTasks: TaskSelectDecoded[];
  tagDoneTasks: TaskSelectDecoded[];
  tagOverdueTasks: TaskSelectDecoded[];
  tagTodoTasks: TaskSelectDecoded[];
  unplannedTasks: TaskSelectDecoded[];
}) {
  if (isLoading) {
    return renderSidebarLoadingContent();
  }

  if (!activeItem) {
    return null;
  }

  if (error) {
    return (
      <p className="px-4 py-6 text-destructive text-sm" role="alert">
        Couldn't load your tasks. Check your connection and reload.
      </p>
    );
  }

  if (activeItem.type === "tag") {
    return renderTagContent({
      doneTasks: tagDoneTasks,
      overdueTasks: tagOverdueTasks,
      tagId: activeItem.tagId,
      todoTasks: tagTodoTasks,
    });
  }

  switch (activeItem.id) {
    case "inbox":
      return renderInboxContent(inboxTasks);
    case "today":
      return renderTodayContent({
        dateTitle,
        doneTasks,
        overdueTasks,
        plannedTasks,
        unplannedTasks,
      });
    default:
      return null;
  }
}

export function SidebarLeft({ ...props }: ComponentProps<typeof Sidebar>) {
  const [activeViewSelection, setActiveViewSelection] = useAtom(
    sidebarLeftViewSelectionAtom
  );
  const currentDate = useAtomValue(currentDateAtom);
  const today = useAtomValue(todayPlainDateAtom);
  const { open, setOpen } = useSidebar();
  const { tagsQuery } = useTags();
  const dateTitle = useMemo(
    () => formatDateSidebarTitle(currentDate, today),
    [currentDate, today]
  );
  const {
    tasksQuery,
    inboxTasks,
    overdueTasks,
    plannedTasks,
    unplannedTasks,
    doneTasks,
  } = useTaskSections({ targetDate: currentDate });
  const activeTagId =
    activeViewSelection.type === "tag" ? activeViewSelection.tagId : null;
  const {
    doneTasks: tagDoneTasks,
    overdueTasks: tagOverdueTasks,
    todoTasks: tagTodoTasks,
  } = useTagTaskSections(activeTagId);

  const navItems = useMemo(() => {
    const baseItems = navMain.map((item) =>
      item.id === "today" ? { ...item, title: dateTitle } : item
    );
    const tagItems =
      tagsQuery.data?.map((tag) => ({
        icon: tagIconMap[tag.icon],
        id: `tag-${tag.id}`,
        tagId: tag.id,
        title: tag.name,
        type: "tag" as const,
      })) ?? [];

    return [...baseItems, ...tagItems];
  }, [dateTitle, tagsQuery.data]);

  const activeItem = useMemo(() => {
    if (activeViewSelection.type === "base") {
      return getBaseSidebarNavItem(navItems, activeViewSelection.id);
    }

    return (
      navItems.find(
        (item) =>
          item.type === "tag" && item.tagId === activeViewSelection.tagId
      ) ?? null
    );
  }, [activeViewSelection, navItems]);

  useEffect(() => {
    if (
      activeViewSelection.type !== "tag" ||
      tagsQuery.data === undefined ||
      tagsQuery.data.some((tag) => tag.id === activeViewSelection.tagId)
    ) {
      return;
    }

    // Reset stale persisted tags back to Inbox once the tag list has loaded.
    setActiveViewSelection(defaultSidebarLeftViewSelection);
  }, [activeViewSelection, setActiveViewSelection, tagsQuery.data]);

  const isSidebarLoading =
    (tasksQuery.data === undefined && tasksQuery.error == null) ||
    (tagsQuery.data === undefined && tagsQuery.error == null);

  const { setNodeRef, isOver } = useDroppable({
    data: {
      activeTab: activeItem?.title ?? "Inbox",
      sidebarTargetDate:
        activeViewSelection.type === "base" &&
        activeViewSelection.id === "today"
          ? currentDate.toString()
          : undefined,
      sidebarView:
        activeViewSelection.type === "base"
          ? activeViewSelection.id
          : undefined,
    },
    id: SIDEBAR_TASK_LIST_DROPPABLE_ID,
  });

  const content = useMemo(
    () =>
      getSidebarContent({
        activeItem,
        dateTitle,
        doneTasks,
        // A failed refresh keeps the tasks already loaded (the query's error
        // toast offers a retry); the error replaces the list only when
        // there is nothing to show.
        error: tasksQuery.data === undefined ? tasksQuery.error : null,
        inboxTasks,
        isLoading: isSidebarLoading,
        overdueTasks,
        plannedTasks,
        tagDoneTasks,
        tagOverdueTasks,
        tagTodoTasks,
        unplannedTasks,
      }),
    [
      activeItem,
      dateTitle,
      doneTasks,
      inboxTasks,
      isSidebarLoading,
      overdueTasks,
      plannedTasks,
      tasksQuery.data,
      tasksQuery.error,
      tagDoneTasks,
      tagOverdueTasks,
      tagTodoTasks,
      unplannedTasks,
    ]
  );

  return (
    <Sidebar
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      collapsible="icon"
      mobile="inline"
      {...props}
    >
      <Sidebar
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
        collapsible="none"
        mobile="inline"
      >
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-0">
              <SidebarMenu>
                {navItems.map((item, index) => (
                  <SidebarMenuItem
                    className={cn(
                      item.type === "tag" &&
                        navItems[index - 1]?.type === "base"
                        ? "mt-2 border-sidebar-border border-t pt-2"
                        : ""
                    )}
                    key={item.id}
                  >
                    <SidebarMenuButton
                      className="justify-center gap-0 px-0 text-muted-foreground data-[active=true]:text-sidebar-accent-foreground"
                      isActive={activeItem?.id === item.id}
                      onClick={() => {
                        // The open list's own icon hides the panel; any
                        // other icon shows that list.
                        if (open && activeItem?.id === item.id) {
                          setOpen(false);
                          return;
                        }
                        setActiveViewSelection(
                          getSidebarSelectionFromNavItem(item)
                        );
                        setOpen(true);
                      }}
                      tooltip={{
                        children:
                          open && activeItem?.id === item.id
                            ? `Hide ${item.title}`
                            : item.title,
                        hidden: false,
                      }}
                    >
                      <item.icon />
                      <span className="sr-only">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <Sidebar className="min-w-0 flex-1" collapsible="none" mobile="inline">
        <div
          className={cn(
            "flex size-full min-h-[200px] flex-1 flex-col transition-colors",
            isOver ? "bg-primary/10" : ""
          )}
          ref={setNodeRef}
        >
          <SidebarHeader className="h-12 shrink-0 justify-center border-b p-0">
            <div className="flex items-center justify-between gap-2 pr-2 pl-4">
              <h2 className="min-w-0 flex-1 truncate font-medium text-base text-foreground">
                {activeItem?.title ??
                  (activeViewSelection.type === "tag" ? "Tag" : "Inbox")}
              </h2>
              <CreateTaskForm
                defaultStartDateString={
                  activeViewSelection.type === "base" &&
                  activeViewSelection.id === "today"
                    ? currentDate.toString()
                    : undefined
                }
                defaultTagIds={
                  activeViewSelection.type === "tag"
                    ? [activeViewSelection.tagId]
                    : []
                }
              />
            </div>
          </SidebarHeader>
          <SidebarContent className="flex-1">
            <SidebarGroup className="flex-1 px-0">
              <SidebarGroupContent
                className="flex-1"
                key={activeItem?.id ?? "inbox"}
              >
                {content}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </div>
      </Sidebar>

      <SidebarRail />
    </Sidebar>
  );
}
