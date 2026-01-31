"use client";

import { useDroppable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useAtomValue } from "jotai";
import { CalendarClock, Inbox } from "lucide-react";
import { type ComponentProps, useMemo, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { timezoneAtom } from "@/atoms/current-date";
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
import { useTasks } from "@/hooks/use-tasks";
import { todayPlainDate } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { TaskItem } from "./task-item";

/** Droppable ID for the sidebar task list area */
export const SIDEBAR_TASK_LIST_DROPPABLE_ID = "sidebar-task-list";

// Navigation tabs for the sidebar icon strip
const navMain = [
  {
    title: "Inbox",
    url: "/dashboard",
    icon: Inbox,
  },
  {
    title: "Today",
    url: "/dashboard",
    icon: CalendarClock,
  },
];

// ============================================================================
// TASK FILTERS
// ============================================================================

/** Filter out recurring tasks (both masters and occurrences) */
const isNonRecurring = (task: TaskSelectDecoded): boolean =>
  task.seriesMasterId === null;

/** Inbox: uncompleted tasks with no startDate/startTime */
const isInboxTask = (task: TaskSelectDecoded): boolean =>
  task.status !== "done" && task.startDate === null && task.startTime === null;

/** Overdue: uncompleted tasks with due date in the past */
const isOverdue = (
  task: TaskSelectDecoded,
  today: Temporal.PlainDate
): boolean =>
  task.status !== "done" &&
  task.dueDate !== null &&
  Temporal.PlainDate.compare(task.dueDate, today) < 0;

/** Unplanned: tasks with past/today startDate, no startTime, due date in future (or null) */
const isUnplanned = (
  task: TaskSelectDecoded,
  today: Temporal.PlainDate
): boolean =>
  task.startDate !== null &&
  task.startTime === null &&
  Temporal.PlainDate.compare(task.startDate, today) <= 0 &&
  (task.dueDate === null ||
    Temporal.PlainDate.compare(task.dueDate, today) > 0);

export function SidebarLeft({ ...props }: ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = useState(navMain[0]);
  const { setOpen } = useSidebar();
  const timeZone = useAtomValue(timezoneAtom);
  const {
    tasksQuery: { data: tasks, isLoading, error },
  } = useTasks();

  // Make the task list a droppable area, passing the active tab for context-aware behavior
  const { setNodeRef, isOver } = useDroppable({
    id: SIDEBAR_TASK_LIST_DROPPABLE_ID,
    data: {
      activeTab: activeItem?.title ?? "Inbox",
    },
  });

  // Get today's date for filtering
  const today = useMemo(() => todayPlainDate(timeZone), [timeZone]);

  // Filter and sort tasks based on active view
  const { inboxTasks, overdueTasks, unplannedTasks } = useMemo(() => {
    if (!tasks) {
      return { inboxTasks: [], overdueTasks: [], unplannedTasks: [] };
    }

    // Base filter: exclude recurring tasks
    const nonRecurring = tasks.filter(isNonRecurring);

    // Inbox: uncompleted, no startDate/startTime, sorted by updatedAt desc
    const inbox = nonRecurring
      .filter(isInboxTask)
      .sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

    // Today view sections
    const overdue = nonRecurring.filter((t) => isOverdue(t, today));
    const unplanned = nonRecurring.filter((t) => isUnplanned(t, today));

    return {
      inboxTasks: inbox,
      overdueTasks: overdue,
      unplannedTasks: unplanned,
    };
  }, [tasks, today]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="p-4 text-muted-foreground text-sm">
          Loading tasks...
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-4 text-destructive text-sm">Failed to load tasks</div>
      );
    }

    // Inbox view: flat list sorted by updatedAt
    if (activeItem?.title === "Inbox") {
      if (inboxTasks.length === 0) {
        return (
          <div className="p-4 text-muted-foreground text-sm">
            No tasks in inbox.
          </div>
        );
      }
      return inboxTasks.map((task) => <TaskItem key={task.id} task={task} />);
    }

    // Today view: sections for Overdue and Unplanned
    if (activeItem?.title === "Today") {
      const hasOverdue = overdueTasks.length > 0;
      const hasUnplanned = unplannedTasks.length > 0;

      if (!(hasOverdue || hasUnplanned)) {
        return (
          <div className="p-4 text-muted-foreground text-sm">
            Nothing for today.
          </div>
        );
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
        </div>
      );
    }

    // Fallback (shouldn't happen)
    return null;
  };

  return (
    <Sidebar
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      collapsible="icon"
      {...props}
    >
      {/* This is the first sidebar */}
      {/* We disable collapsible and adjust width to icon. */}
      {/* This will make the sidebar appear as icons. */}
      <Sidebar
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
        collapsible="none"
      >
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="md:h-8 md:p-0" size="lg">
                <a href="/dashboard">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Inbox className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Kompose</span>
                    <span className="truncate text-xs">App</span>
                  </div>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">
              <SidebarMenu>
                {navMain.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      className="px-2.5 md:px-2"
                      isActive={activeItem?.title === item.title}
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
                      <span>{item.title}</span>
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
      <Sidebar className="hidden min-w-0 flex-1 md:flex" collapsible="none">
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
              <CreateTaskForm />
            </div>
          </SidebarHeader>
          <SidebarContent className="flex-1">
            <SidebarGroup className="flex-1 px-0">
              <SidebarGroupContent className="flex-1">
                {renderContent()}
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
