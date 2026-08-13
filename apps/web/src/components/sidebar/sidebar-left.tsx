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

/** Droppable ID for the sidebar task list area */
export const SIDEBAR_TASK_LIST_DROPPABLE_ID = "sidebar-task-list";

// Navigation tabs for the sidebar icon strip
interface SidebarNavItem {
  icon: LucideIcon;
  id: string;
  tagId?: string;
  title: string;
  type: "base" | "tag";
}

const navMain: SidebarNavItem[] = [
  {
    id: "inbox",
    title: "Inbox",
    icon: Inbox,
    type: "base",
  },
  {
    id: "today",
    title: "Today",
    icon: CalendarClock,
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
    return { type: "tag" as const, tagId: item.tagId };
  }

  return { type: "base" as const, id: item.id as SidebarLeftBaseViewId };
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
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }
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

function renderEmptyMessage(message: string) {
  return <div className="p-4 text-muted-foreground text-sm">{message}</div>;
}

function renderSidebarLoadingContent() {
  const loadingKeys = ["one", "two", "three", "four", "five", "six"] as const;

  return (
    <div className="flex flex-col p-2">
      {loadingKeys.map((key) => (
        <div
          className="mx-2 my-1.5 h-12 rounded-md bg-muted/40"
          key={`sidebar-loading-${key}`}
        />
      ))}
    </div>
  );
}

function renderInboxContent(inboxTasks: TaskSelectDecoded[]) {
  if (inboxTasks.length === 0) {
    return renderEmptyMessage("No tasks in inbox.");
  }
  return inboxTasks.map((task) => <TaskItem key={task.id} task={task} />);
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
  const hasOverdue = overdueTasks.length > 0;
  const hasPlanned = plannedTasks.length > 0;
  const hasUnplanned = unplannedTasks.length > 0;
  const hasDone = doneTasks.length > 0;

  if (!(hasOverdue || hasPlanned || hasUnplanned || hasDone)) {
    return renderEmptyMessage(formatDateSidebarEmptyMessage(dateTitle));
  }

  return (
    <div className="flex flex-col">
      {/* Overdue section */}
      {hasOverdue && (
        <div>
          <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Overdue
          </div>
          {overdueTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Unplanned section */}
      {hasUnplanned && (
        <div>
          <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Unplanned
          </div>
          {unplannedTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Planned section */}
      {hasPlanned && (
        <div>
          <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Planned
          </div>
          {plannedTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Done section */}
      {hasDone && (
        <div>
          <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Done
          </div>
          {doneTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

function renderTagContent({
  overdueTasks,
  todoTasks,
  doneTasks,
}: {
  overdueTasks: TaskSelectDecoded[];
  todoTasks: TaskSelectDecoded[];
  doneTasks: TaskSelectDecoded[];
}) {
  const hasOverdue = overdueTasks.length > 0;
  const hasTodo = todoTasks.length > 0;
  const hasDone = doneTasks.length > 0;

  if (!(hasOverdue || hasTodo || hasDone)) {
    return renderEmptyMessage("No tasks for this tag.");
  }

  return (
    <div className="flex flex-col">
      {hasOverdue && (
        <div>
          <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Overdue
          </div>
          {overdueTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}

      {hasTodo && (
        <div>
          <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Todo
          </div>
          {todoTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}

      {hasDone && (
        <div>
          <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Done
          </div>
          {doneTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
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
      <div className="p-4 text-destructive text-sm">Failed to load tasks</div>
    );
  }

  if (activeItem.type === "tag") {
    return renderTagContent({
      overdueTasks: tagOverdueTasks,
      todoTasks: tagTodoTasks,
      doneTasks: tagDoneTasks,
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
  const { setOpen } = useSidebar();
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
        id: `tag-${tag.id}`,
        title: tag.name,
        icon: tagIconMap[tag.icon],
        type: "tag" as const,
        tagId: tag.id,
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

  // Make the task list a droppable area, passing the active tab for context-aware behavior
  const { setNodeRef, isOver } = useDroppable({
    id: SIDEBAR_TASK_LIST_DROPPABLE_ID,
    data: {
      sidebarTargetDate:
        activeViewSelection.type === "base" &&
        activeViewSelection.id === "today"
          ? currentDate.toString()
          : undefined,
      sidebarView:
        activeViewSelection.type === "base"
          ? activeViewSelection.id
          : undefined,
      activeTab: activeItem?.title ?? "Inbox",
    },
  });

  const content = useMemo(
    () =>
      getSidebarContent({
        activeItem,
        dateTitle,
        doneTasks,
        error: tasksQuery.error,
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
      {/* This is the first sidebar */}
      {/* We disable collapsible and adjust width to icon. */}
      {/* This will make the sidebar appear as icons. */}
      <Sidebar
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
        collapsible="none"
        mobile="inline"
      >
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-0">
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      className="justify-center gap-0 px-0"
                      isActive={activeItem?.id === item.id}
                      onClick={() => {
                        setActiveViewSelection(
                          getSidebarSelectionFromNavItem(item)
                        );
                        setOpen(true);
                      }}
                      tooltip={{
                        children: item.title,
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

      {/* This is the second sidebar */}
      {/* We disable collapsible and let it fill remaining space */}
      <Sidebar className="min-w-0 flex-1" collapsible="none" mobile="inline">
        <div
          className={cn(
            "flex size-full min-h-[200px] flex-1 flex-col transition-colors",
            isOver ? "bg-primary/10" : ""
          )}
          ref={setNodeRef}
        >
          <SidebarHeader className="h-12 shrink-0 border-b">
            <div className="flex size-full items-center justify-between gap-2 px-4">
              <div className="min-w-0 flex-1 truncate font-medium text-base text-foreground">
                {activeItem?.title ??
                  (activeViewSelection.type === "tag" ? "Tag" : "Inbox")}
              </div>
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

      {/* Rail for toggling the left sidebar */}
      <SidebarRail />
    </Sidebar>
  );
}
