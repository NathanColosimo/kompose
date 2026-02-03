"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTaskSections } from "@kompose/state/hooks/use-task-sections";
import { CalendarClock, Inbox } from "lucide-react";
import { type ComponentProps, useMemo, useState } from "react";
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

export function SidebarLeft({ ...props }: ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = useState(navMain[0]);
  const { setOpen } = useSidebar();
  const {
    tasksQuery: { isLoading, error },
    inboxTasks,
    overdueTasks,
    unplannedTasks,
  } = useTaskSections();
  const activeView = activeItem?.title ?? "Inbox";

  // Make the task list a droppable area, passing the active tab for context-aware behavior
  const { setNodeRef, isOver } = useDroppable({
    id: SIDEBAR_TASK_LIST_DROPPABLE_ID,
    data: {
      activeTab: activeItem?.title ?? "Inbox",
    },
  });

  const content = useMemo(() => {
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
    if (activeView === "Inbox") {
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
    if (activeView === "Today") {
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
  }, [activeView, error, inboxTasks, isLoading, overdueTasks, unplannedTasks]);

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
              <SidebarGroupContent className="flex-1" key={activeView}>
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
