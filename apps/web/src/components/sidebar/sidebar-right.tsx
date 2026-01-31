"use client";

import type * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from "@/components/ui/sidebar";

export function SidebarRight({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" side="right" variant="sidebar" {...props}>
      <SidebarHeader className="h-12 shrink-0 border-sidebar-border border-b" />
      <SidebarContent />
      <SidebarFooter>
        <SidebarMenu>{/* Placeholder for future content */}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
