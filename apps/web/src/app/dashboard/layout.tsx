"use client";

import { useRealtimeSync } from "@kompose/state/hooks/use-realtime-sync";
import { deserializeCommandBarTaskOpenRequest } from "@kompose/state/task-search-routing";
import { useSetAtom } from "jotai";
import { useRouter } from "next/navigation";
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
import { usePreloadTaskParser } from "@/lib/use-magic-task";
import { applyCommandBarTaskOpenRequestAtom } from "@/state/command-bar";
import {
  dashboardViewportWidthAtom,
  SIDEBAR_LEFT_WIDTH,
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
  const {
    data: session,
    error: sessionError,
    isPending: isSessionPending,
    isRefetching,
    refetch: refetchSession,
  } = authClient.useSession();
  const sessionUser = session?.user;
  const { push } = useRouter();
  const setViewportWidth = useSetAtom(dashboardViewportWidthAtom);
  const applyCommandBarTaskOpenRequest = useSetAtom(
    applyCommandBarTaskOpenRequestAtom
  );
  useRealtimeSync({ userId: sessionUser?.id });
  usePreloadTaskParser();

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
