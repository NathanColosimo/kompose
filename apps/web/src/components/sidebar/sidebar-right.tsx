"use client";

import type * as React from "react";
import { NavUser } from "@/components/sidebar/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

export function SidebarRight({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession();

  const user = session?.user;
  if (!user) {
    return null;
  }

  return (
    <Sidebar collapsible="offcanvas" side="right" variant="sidebar" {...props}>
      <SidebarHeader className="h-12 shrink-0 border-sidebar-border border-b p-0">
        <NavUser user={user} />
      </SidebarHeader>
      <SidebarContent />
      <SidebarFooter>
        <SidebarMenu>{/* Removed New Calendar button */}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
