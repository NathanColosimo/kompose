"use client";

import { Inbox } from "lucide-react";
// biome-ignore lint/performance/noNamespaceImport: Imported Component
import * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

// This is sample data
const data = {
  navMain: [
    {
      title: "Inbox",
      url: "/dashboard",
      icon: Inbox,
      isActive: true,
    },
  ],
  tasks: [
    {
      id: "1",
      title: "Review project proposal",
      date: "Today",
      description: "Go through the new project proposal and add comments.",
    },
    {
      id: "2",
      title: "Team meeting",
      date: "Tomorrow",
      description: "Weekly sync with the engineering team.",
    },
    {
      id: "3",
      title: "Update documentation",
      date: "2 days ago",
      description: "Update the API documentation with the latest changes.",
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  // Note: I'm using state to show active item.
  // IRL you should use the url/router.
  const [activeItem, setActiveItem] = React.useState(data.navMain[0]);
  const { setOpen } = useSidebar();

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
                {data.navMain.map((item) => (
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
      <Sidebar className="hidden flex-1 md:flex" collapsible="none">
        <SidebarHeader className="gap-3.5 border-b p-4">
          <div className="flex w-full items-center justify-between">
            <div className="font-medium text-base text-foreground">
              {activeItem?.title}
            </div>
          </div>
          <SidebarInput placeholder="Type to search..." />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="px-0">
            <SidebarGroupContent>
              {data.tasks.map((task) => (
                <a
                  className="flex flex-col items-start gap-2 whitespace-nowrap border-b p-4 text-sm leading-tight last:border-b-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  href={`/dashboard/${task.id}`}
                  key={task.id}
                >
                  <div className="flex w-full items-center gap-2">
                    <span>{task.title}</span>{" "}
                    <span className="ml-auto text-xs">{task.date}</span>
                  </div>
                  <span className="line-clamp-2 w-[260px] whitespace-break-spaces text-xs">
                    {task.description}
                  </span>
                </a>
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  );
}
