"use client";

import { useAtomValue } from "jotai";
import dynamic from "next/dynamic";
import type * as React from "react";
import { Sidebar, SidebarRail } from "@/components/ui/sidebar";
import {
  dashboardResponsiveLayoutAtom,
  SIDEBAR_RIGHT_WIDTH,
  sidebarRightOpenAtom,
  sidebarRightOverlayOpenAtom,
} from "@/state/sidebar";

const LazySidebarRightChat = dynamic(
  () =>
    import("./sidebar-right-chat").then((mod) => ({
      default: mod.SidebarRightChat,
    })),
  { ssr: false }
);

export function SidebarRight({
  style,
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const responsiveLayout = useAtomValue(dashboardResponsiveLayoutAtom);
  const rightSidebarOpen = useAtomValue(sidebarRightOpenAtom);
  const overlayOpen = useAtomValue(sidebarRightOverlayOpenAtom);
  const shouldRenderChat = responsiveLayout.canDockRightSidebar
    ? rightSidebarOpen
    : overlayOpen;

  if (!responsiveLayout.canDockRightSidebar) {
    return (
      <div
        aria-hidden={!overlayOpen}
        className="fixed top-(--header-height,0) right-0 z-40 h-[calc(100svh-var(--header-height,0px))] w-screen border-l bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-linear"
        style={{
          pointerEvents: overlayOpen ? "auto" : "none",
          transform: overlayOpen ? "translateX(0%)" : "translateX(100%)",
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          {shouldRenderChat ? <LazySidebarRightChat /> : null}
        </div>
      </div>
    );
  }

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
      {shouldRenderChat ? <LazySidebarRightChat /> : null}
      <SidebarRail />
    </Sidebar>
  );
}
