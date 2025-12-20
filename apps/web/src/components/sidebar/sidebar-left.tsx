"use client";

import { useDroppable } from "@dnd-kit/core";
import { Inbox } from "lucide-react";
import { type ComponentProps, useState } from "react";
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
import { cn } from "@/lib/utils";
import { TaskItem } from "./task-item";

/** Droppable ID for the sidebar task list area */
export const SIDEBAR_TASK_LIST_DROPPABLE_ID = "sidebar-task-list";

// This is sample data
const navMain = [
  {
    title: "Inbox",
    url: "/dashboard",
    icon: Inbox,
    isActive: true,
  },
];

export function SidebarLeft({ ...props }: ComponentProps<typeof Sidebar>) {
  // Note: I'm using state to show active item.
  // IRL you should use the url/router.
  const [activeItem, setActiveItem] = useState(navMain[0]);
  const { setOpen } = useSidebar();
  const {
    tasksQuery: { data: tasks, isLoading, error },
  } = useTasks();

  // Make the task list a droppable area
  const { setNodeRef, isOver } = useDroppable({
    id: SIDEBAR_TASK_LIST_DROPPABLE_ID,
  });

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

    if (!tasks || tasks.length === 0) {
      return (
        <div className="p-4 text-muted-foreground text-sm">No tasks found.</div>
      );
    }

    return tasks.map((task) => <TaskItem key={task.id} task={task} />);
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
