"use client";

import { commandBarTaskOpenRequestAtom } from "@kompose/state/atoms/command-bar";
import { currentDateAtom } from "@kompose/state/atoms/current-date";
import { deserializeCommandBarTaskOpenRequest } from "@kompose/state/task-search-routing";
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
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useWebRealtimeSync } from "@/hooks/use-realtime-sync";
import { authClient } from "@/lib/auth-client";
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
  sidebarLeftViewSelectionAtom,
  sidebarRightOpenAtom,
  sidebarRightOverlayOpenAtom,
} from "@/state/sidebar";

function LoginRedirect() {
  const { replace } = useRouter();

  useMountEffect(() => {
    replace("/login");
  });

  return null;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const sessionUser = session?.user;
  const [rightSidebarOpen, setRightSidebarOpen] = useAtom(sidebarRightOpenAtom);
  const responsiveLayout = useAtomValue(dashboardResponsiveLayoutAtom);
  const setViewportWidth = useSetAtom(dashboardViewportWidthAtom);
  const setRightSidebarOverlayOpen = useSetAtom(sidebarRightOverlayOpenAtom);
  const setCommandBarTaskOpenRequest = useSetAtom(
    commandBarTaskOpenRequestAtom
  );
  const setCurrentDate = useSetAtom(currentDateAtom);
  const setSidebarLeftOpen = useSetAtom(sidebarLeftOpenAtom);
  const setSidebarLeftViewSelection = useSetAtom(sidebarLeftViewSelectionAtom);
  useWebRealtimeSync(sessionUser?.id);

  // Keep a live viewport width so day/sidebar capacity can be derived centrally.
  useLayoutEffect(() => {
    const updateWidth = () => {
      setViewportWidth(window.innerWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [setViewportWidth]);

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

    let disposed = false;
    let cleanup: (() => void) | null = null;

    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const unlisten = await listen(COMMAND_BAR_TASK_OPEN_EVENT, (event) => {
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
            setSidebarLeftOpen,
            setSidebarLeftViewSelection,
          });
        });
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        console.warn(
          "Failed to listen for command bar task open events.",
          error
        );
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [
    setCommandBarTaskOpenRequest,
    setCurrentDate,
    setSidebarLeftOpen,
    setSidebarLeftViewSelection,
  ]);

  if (isSessionPending) {
    return null;
  }

  if (!sessionUser) {
    return <LoginRedirect />;
  }

  return (
    <div
      className="flex h-svh flex-col"
      data-dashboard-layout
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
