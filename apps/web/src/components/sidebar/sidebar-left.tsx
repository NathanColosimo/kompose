"use client";

import { useDroppable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useTagTaskSections } from "@kompose/state/hooks/use-tag-task-sections";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTaskSections } from "@kompose/state/hooks/use-task-sections";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, Inbox } from "lucide-react";
import { type ComponentProps, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
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

function renderEmptyMessage(message: string) {
  return <div className="p-4 text-muted-foreground text-sm">{message}</div>;
}

function renderInboxContent(inboxTasks: TaskSelectDecoded[]) {
  if (inboxTasks.length === 0) {
    return renderEmptyMessage("No tasks in inbox.");
  }
  return inboxTasks.map((task) => <TaskItem key={task.id} task={task} />);
}

function renderTodayContent({
  overdueTasks,
  plannedTasks,
  doneTasks,
  unplannedTasks,
}: {
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
    return renderEmptyMessage("Nothing for today.");
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

      {/* Planned section — scheduled on today's calendar, not yet overdue */}
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
  if (!activeItem) {
    return null;
  }

  if (isLoading) {
    return renderEmptyMessage("Loading tasks...");
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
  const [activeItem, setActiveItem] = useState<SidebarNavItem | null>(
    navMain[0]
  );
  const { setOpen } = useSidebar();
  const { tagsQuery } = useTags();
  const {
    tasksQuery: { isLoading, error },
    inboxTasks,
    overdueTasks,
    plannedTasks,
    unplannedTasks,
    doneTasks,
  } = useTaskSections();
  const activeTagId =
    activeItem?.type === "tag" ? (activeItem.tagId ?? null) : null;
  const {
    doneTasks: tagDoneTasks,
    overdueTasks: tagOverdueTasks,
    todoTasks: tagTodoTasks,
  } = useTagTaskSections(activeTagId);

  const navItems = useMemo(() => {
    const tagItems =
      tagsQuery.data?.map((tag) => ({
        id: `tag-${tag.id}`,
        title: tag.name,
        icon: tagIconMap[tag.icon],
        type: "tag" as const,
        tagId: tag.id,
      })) ?? [];

    return [...navMain, ...tagItems];
  }, [tagsQuery.data]);

  // Make the task list a droppable area, passing the active tab for context-aware behavior
  const { setNodeRef, isOver } = useDroppable({
    id: SIDEBAR_TASK_LIST_DROPPABLE_ID,
    data: {
      activeTab: activeItem?.title ?? "Inbox",
    },
  });

  const content = useMemo(
    () =>
      getSidebarContent({
        activeItem,
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
      }),
    [
      activeItem,
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
                        setActiveItem(item);
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
            "flex h-full min-h-[200px] w-full flex-1 flex-col transition-colors",
            isOver ? "bg-primary/10" : ""
          )}
          ref={setNodeRef}
        >
          <SidebarHeader className="h-12 shrink-0 border-b">
            <div className="flex h-full w-full items-center justify-between gap-2 px-4">
              <div className="min-w-0 flex-1 truncate font-medium text-base text-foreground">
                {activeItem?.title}
              </div>
              <CreateTaskForm
                defaultTagIds={
                  activeItem?.type === "tag" && activeItem.tagId
                    ? [activeItem.tagId]
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
