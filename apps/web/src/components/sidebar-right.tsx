"use client";

import type * as React from "react";

import { Calendars } from "@/components/calendars";
import { DatePicker } from "@/components/date-picker";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

export function SidebarRight({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession();

  const user = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        avatar: session.user.image || "",
      }
    : {
        name: "User",
        email: "user@example.com",
        avatar: "",
      };

  // Mock calendar data for now, simpler than before
  const calendars = [
    {
      name: "My Calendars",
      items: ["Personal", "Work", "Family"],
    },
  ];

  return (
    <Sidebar collapsible="offcanvas" side="right" variant="sidebar" {...props}>
      <SidebarHeader className="h-16 border-sidebar-border border-b">
        <NavUser user={user} />
      </SidebarHeader>
      <SidebarContent>
        <DatePicker />
        <SidebarSeparator className="mx-0" />
        <Calendars calendars={calendars} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>{/* Removed New Calendar button */}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
