"use client";

import { commandBarTaskOpenRequestAtom } from "@kompose/state/atoms/command-bar";
import { tagsQueryAtom } from "@kompose/state/atoms/tags";
import { tasksQueryAtom } from "@kompose/state/atoms/tasks";
import { useRealtimeSync } from "@kompose/state/hooks/use-realtime-sync";
import { deserializeCommandBarTaskOpenRequest } from "@kompose/state/task-search-routing";
import { useAtom, useAtomValue, useAtomValueRawSync, useSetAtom } from "jotai";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";
import { AppHeader } from "@/components/app-header";
import { SessionFeedback } from "@/components/auth/session-feedback";
import { CalendarDndProvider } from "@/components/calendar/dnd-context";
import { CommandBar } from "@/components/command-bar/command-bar";
import { DashboardQueries } from "@/components/dashboard-queries";
import { CalendarHotkeys } from "@/components/hotkeys/calendar-hotkeys";
import { SidebarLeft } from "@/components/sidebar/sidebar-left";
import { SidebarRight } from "@/components/sidebar/sidebar-right";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import { desktopBridge, isDesktopRuntime } from "@/lib/desktop";
import { usePreloadTaskParserAfterData } from "@/lib/use-magic-task";
import { createEventRequestedAtom } from "@/state/calendar-navigation";
import { applyCommandBarTaskOpenRequestAtom } from "@/state/command-bar";
import {
  dashboardResponsiveLayoutAtom,
  dashboardViewportWidthAtom,
  isNarrowViewportAtom,
  SIDEBAR_LEFT_WIDTH,
  sidebarLeftNarrowOpenAtom,
  sidebarRightOpenAtom,
  sidebarRightOverlayOpenAtom,
} from "@/state/sidebar";

/** Its own component, so task and tag updates don't re-render the layout. */
function TaskParserPreload() {
  const tasks = useAtomValue(tasksQueryAtom);
  const tags = useAtomValue(tagsQueryAtom);
  usePreloadTaskParserAfterData(!(tasks.isPending || tags.isPending));
  return null;
}

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
  const {
    data: session,
    error: sessionError,
    isPending: isSessionPending,
    isRefetching,
    refetch: refetchSession,
  } = authClient.useSession();
  const sessionUser = session?.user;
  const [rightSidebarOpen, setRightSidebarOpen] = useAtom(sidebarRightOpenAtom);
  // The first viewport measurement runs in a layout effect, before useAtomValue subscribes.
  const responsiveLayout = useAtomValueRawSync(dashboardResponsiveLayoutAtom);
  const viewportWidth = useAtomValueRawSync(dashboardViewportWidthAtom);
  const { push } = useRouter();
  const setViewportWidth = useSetAtom(dashboardViewportWidthAtom);
  const setRightSidebarOverlayOpen = useSetAtom(sidebarRightOverlayOpenAtom);
  const applyCommandBarTaskOpenRequest = useSetAtom(
    applyCommandBarTaskOpenRequestAtom
  );
  useRealtimeSync({ userId: sessionUser?.id });

  // Keep a live viewport width so day/sidebar capacity can be derived centrally.
  useLayoutEffect(() => {
    const updateWidth = () => {
      setViewportWidth(window.innerWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [setViewportWidth]);

  // Constrained widths use overlay mode for right sidebar, so docked open must reset.
  useEffect(() => {
    // Do not clear the saved preference before the first viewport measurement.
    if (
      viewportWidth === 0 ||
      responsiveLayout.canDockRightSidebar ||
      !rightSidebarOpen
    ) {
      return;
    }
    setRightSidebarOpen(false);
  }, [
    responsiveLayout.canDockRightSidebar,
    rightSidebarOpen,
    setRightSidebarOpen,
    viewportWidth,
  ]);

  // Below the md breakpoint the task panel would leave the calendar about
  // one cramped day, so it folds each time the window narrows. The saved
  // choice is untouched; see sidebarLeftOpenAtom.
  const isNarrow = useAtomValue(isNarrowViewportAtom);
  const [narrowOpen, setNarrowOpen] = useAtom(sidebarLeftNarrowOpenAtom);
  // There the open task panel is the whole view, a list; the calendar
  // behind it is clipped and inert, so it neither widens the page nor takes
  // Tab, and keeps its place for when the list closes.
  const showsTaskList = isNarrow && narrowOpen;
  // The calendar or page takes over from that list whenever it's asked for:
  // on leaving the calendar (Settings shows), and on a request to create an
  // event or open a task on the calendar, since their popovers anchor in it.
  // Those requests come from the command bar, the "c" key and the desktop
  // app. Arriving at the calendar keeps the list, which a request for an
  // Inbox task may just have opened.
  const pathname = usePathname();
  const createEventRequestedAt = useAtomValue(createEventRequestedAtom);
  const calendarTaskRequested =
    useAtomValue(commandBarTaskOpenRequestAtom)?.target === "calendar";
  useEffect(() => {
    if (pathname !== "/dashboard") {
      setNarrowOpen(false);
    }
  }, [pathname, setNarrowOpen]);
  useEffect(() => {
    if (createEventRequestedAt !== null || calendarTaskRequested) {
      setNarrowOpen(false);
    }
  }, [calendarTaskRequested, createEventRequestedAt, setNarrowOpen]);
  useEffect(() => {
    if (isNarrow) {
      setNarrowOpen(false);
    }
  }, [isNarrow, setNarrowOpen]);

  // When dock mode becomes available again, close overlay-only right sidebar.
  useEffect(() => {
    if (!responsiveLayout.canDockRightSidebar) {
      return;
    }
    setRightSidebarOverlayOpen(false);
  }, [responsiveLayout.canDockRightSidebar, setRightSidebarOverlayOpen]);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }

    return desktopBridge().onOpenTask((payload) => {
      const request = deserializeCommandBarTaskOpenRequest(payload);
      push("/dashboard");
      applyCommandBarTaskOpenRequest(request);
    });
  }, [applyCommandBarTaskOpenRequest, push]);

  if (isSessionPending || (!sessionUser && sessionError)) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6 text-center text-sm">
        <SessionFeedback
          error={Boolean(sessionError)}
          onRetry={refetchSession}
          retrying={isRefetching}
        />
        {isSessionPending ? <DashboardQueries /> : null}
      </main>
    );
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
          "--header-height": "2.5rem",
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <AppHeader user={sessionUser} />

      <SidebarProvider
        className="min-h-0 flex-1"
        style={
          {
            // Keep a stable left-sidebar width while the calendar region
            // clamps itself. In a narrow window there's no room for both,
            // so the open task panel takes the whole width (a list), and
            // its rail icon goes back to the calendar.
            "--sidebar-width": isNarrow ? "100vw" : SIDEBAR_LEFT_WIDTH,
          } as React.CSSProperties
        }
      >
        {/* DndContext wraps both sidebar (drag source) and content (drop target) */}
        <CalendarDndProvider>
          <CalendarHotkeys />
          <CommandBar />
          <TaskParserPreload />
          <SidebarLeft />
          <SidebarInset
            className={showsTaskList ? "min-w-0 overflow-hidden" : "min-w-0"}
            inert={showsTaskList}
          >
            {children}
          </SidebarInset>
          <SidebarRight />
        </CalendarDndProvider>
      </SidebarProvider>
    </div>
  );
}
