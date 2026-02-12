"use client";

import type * as React from "react";
import { Sidebar, SidebarRail } from "@/components/ui/sidebar";
import { SIDEBAR_RIGHT_WIDTH } from "@/state/sidebar";
import { SidebarRightChat } from "./sidebar-right-chat";

export function SidebarRight({
  style,
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      collapsible="offcanvas"
      side="right"
      style={
        {
          // Override only the right sidebar width so center remains flexible.
          "--sidebar-width": SIDEBAR_RIGHT_WIDTH,
          ...style,
        } as React.CSSProperties
      }
      variant="sidebar"
      {...props}
    >
      <SidebarRightChat />
      <SidebarRail />
    </Sidebar>
  );
}
