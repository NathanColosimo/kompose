"use client";

import { sessionQueryAtom, sessionUserAtom } from "@kompose/state/config";
import { commandBarTaskOpenRequestAtom } from "@kompose/state/atoms/command-bar";
import { currentDateAtom } from "@kompose/state/atoms/current-date";
import { deserializeCommandBarTaskOpenRequest } from "@kompose/state/task-search-routing";
import type { User } from "better-auth";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";
import { AppHeader } from "@/components/app-header";
import { CalendarDndProvider } from "@/components/calendar/dnd-context";
import { CommandBar } from "@/components/command-bar/command-bar";
import { CalendarHotkeys } from "@/components/hotkeys/calendar-hotkeys";
import { SidebarLeft } from "@/components/sidebar/sidebar-left";
import { SidebarRight } from "@/components/sidebar/sidebar-right";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  applyCommandBarTaskOpenRequest,
  COMMAND_BAR_TASK_OPEN_EVENT,
} from "@/lib/command-bar-task-routing";
import { isTauriRuntime } from "@/lib/tauri-desktop";
import {
  dashboardResponsiveLayoutAtom,
  dashboardViewportWidthAtom,
  SIDEBAR_LEFT_WIDTH,
  sidebarLeftOpenAtom,
  sidebarRightOpenAtom,
  sidebarRightOverlayOpenAtom,
  sidebarLeftViewSelectionAtom,
} from "@/state/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const sessionQuery = useAtomValue(sessionQueryAtom);
  const sessionUser = useAtomValue(sessionUserAtom) as User | null;
  const [leftSidebarOpen, setLeftSidebarOpen] = useAtom(sidebarLeftOpenAtom);
  const [rightSidebarOpen, setRightSidebarOpen] = useAtom(sidebarRightOpenAtom);
  const responsiveLayout = useAtomValue(dashboardResponsiveLayoutAtom);
  const setViewportWidth = useSetAtom(dashboardViewportWidthAtom);
  const setRightSidebarOverlayOpen = useSetAtom(sidebarRightOverlayOpenAtom);
  const setCommandBarTaskOpenRequest = useSetAtom(commandBarTaskOpenRequestAtom);
  const setCurrentDate = useSetAtom(currentDateAtom);
  const setSidebarLeftViewSelection = useSetAtom(sidebarLeftViewSelectionAtom);

  // Keep a live viewport width so day/sidebar capacity can be derived centrally.
  useLayoutEffect(() => {
    const updateWidth = () => {
      setViewportWidth(window.innerWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [setViewportWidth]);

  useEffect(() => {
    if (sessionQuery.status !== "pending" && !sessionUser) {
      router.replace("/login");
    }
  }, [router, sessionQuery.status, sessionUser]);

  // Constrained widths use overlay mode for right chat, so docked open must reset.
  useEffect(() => {
    if (responsiveLayout.canDockRightSidebar || !rightSidebarOpen) {
      return;
    }
    setRightSidebarOpen(false);
  }, [
    responsiveLayout.canDockRightSidebar,
    rightSidebarOpen,
    setRightSidebarOpen,
  ]);

  // Smallest supported mode should keep the left task panel visible.
  useEffect(() => {
    if (leftSidebarOpen) {
      return;
    }
    setLeftSidebarOpen(true);
  }, [leftSidebarOpen, setLeftSidebarOpen]);

  // When dock mode becomes available again, close overlay-only right chat.
  useEffect(() => {
    if (!responsiveLayout.canDockRightSidebar) {
      return;
    }
    setRightSidebarOverlayOpen(false);
  }, [responsiveLayout.canDockRightSidebar, setRightSidebarOverlayOpen]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let cleanup: (() => void) | null = null;

    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        cleanup = await listen(COMMAND_BAR_TASK_OPEN_EVENT, (event) => {
          if (!event.payload || typeof event.payload !== "object") {
            return;
          }

          const request = deserializeCommandBarTaskOpenRequest(
            event.payload as Parameters<
              typeof deserializeCommandBarTaskOpenRequest
            >[0]
          );

          applyCommandBarTaskOpenRequest(request, {
            setCommandBarTaskOpenRequest,
            setCurrentDate,
            setSidebarLeftViewSelection,
          });
        });
      })
      .catch((error) => {
        console.warn("Failed to listen for command bar task open events.", error);
      });

    return () => {
      cleanup?.();
    };
  }, [
    setCommandBarTaskOpenRequest,
    setCurrentDate,
    setSidebarLeftViewSelection,
  ]);

  if (!sessionUser && sessionQuery.status !== "pending") {
    return null;
  }

  return (
    <div
      className="flex h-svh flex-col"
      style={
        {
          // Header height used by sidebars to offset from top
          "--header-height": "2.5rem",
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      {/* App-wide header with search bar and user menu */}
      <AppHeader user={sessionUser} />

      {/* Main content area below header */}
      <SidebarProvider
        className="min-h-0 flex-1"
        style={
          {
            // Keep a stable left-sidebar width while the calendar region clamps itself.
            "--sidebar-width": SIDEBAR_LEFT_WIDTH,
          } as React.CSSProperties
        }
      >
        {/* DndContext wraps both sidebar (drag source) and content (drop target) */}
        <CalendarDndProvider>
          <CalendarHotkeys />
          <CommandBar />
          <SidebarLeft />
          <SidebarInset>{children}</SidebarInset>
          <SidebarRight />
        </CalendarDndProvider>
      </SidebarProvider>
    </div>
  );
}
