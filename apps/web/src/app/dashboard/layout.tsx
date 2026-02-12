"use client";

import type { User } from "better-auth";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CalendarDndProvider } from "@/components/calendar/dnd-context";
import { CommandBar } from "@/components/command-bar/command-bar";
import { CalendarHotkeys } from "@/components/hotkeys/calendar-hotkeys";
import { SidebarLeft } from "@/components/sidebar/sidebar-left";
import { SidebarRight } from "@/components/sidebar/sidebar-right";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import {
  dashboardResponsiveLayoutAtom,
  dashboardViewportWidthAtom,
  SIDEBAR_LEFT_WIDTH,
  sidebarLeftOpenAtom,
  sidebarRightOpenAtom,
  sidebarRightOverlayOpenAtom,
} from "@/state/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [leftSidebarOpen, setLeftSidebarOpen] = useAtom(sidebarLeftOpenAtom);
  const [rightSidebarOpen, setRightSidebarOpen] = useAtom(sidebarRightOpenAtom);
  const responsiveLayout = useAtomValue(dashboardResponsiveLayoutAtom);
  const setViewportWidth = useSetAtom(dashboardViewportWidthAtom);
  const setRightSidebarOverlayOpen = useSetAtom(sidebarRightOverlayOpenAtom);

  // Ensure the initial client render matches the server render (both return
  // null) to avoid a hydration mismatch caused by the session being available
  // on the client but not during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Keep a live viewport width so day/sidebar capacity can be derived centrally.
  useEffect(() => {
    const updateWidth = () => {
      setViewportWidth(window.innerWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [setViewportWidth]);

  // Always use a direct Better Auth check for dashboard route gating.
  useEffect(() => {
    let cancelled = false;

    const finishCheck = (user: User | null) => {
      if (cancelled) {
        return;
      }
      setSessionUser(user);
      setSessionChecked(true);
      if (!user) {
        router.replace("/login");
      }
    };

    authClient
      .getSession({ query: { disableCookieCache: true } })
      .then((result) =>
        finishCheck((result?.data?.user ?? null) as User | null)
      )
      .catch(() => finishCheck(null));

    return () => {
      cancelled = true;
    };
  }, [router]);

  const hasSession = Boolean(sessionUser);
  const sessionSettled = sessionChecked;

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
    if (responsiveLayout.canShowCalendar || leftSidebarOpen) {
      return;
    }
    setLeftSidebarOpen(true);
  }, [leftSidebarOpen, responsiveLayout.canShowCalendar, setLeftSidebarOpen]);

  // When dock mode becomes available again, close overlay-only right chat.
  useEffect(() => {
    if (
      !responsiveLayout.canDockRightSidebar &&
      responsiveLayout.canShowCalendar
    ) {
      return;
    }
    setRightSidebarOverlayOpen(false);
  }, [
    responsiveLayout.canDockRightSidebar,
    responsiveLayout.canShowCalendar,
    setRightSidebarOverlayOpen,
  ]);

  // Avoid rendering dashboard UI until hydrated and session validated.
  if (!mounted) {
    return null;
  }

  if (!sessionSettled) {
    return null;
  }

  if (!hasSession) {
    return null;
  }

  if (!sessionUser) {
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
            // When calendar cannot fit, expand left sidebar to fill the main area.
            "--sidebar-width": responsiveLayout.canShowCalendar
              ? SIDEBAR_LEFT_WIDTH
              : "100vw",
          } as React.CSSProperties
        }
      >
        {/* DndContext wraps both sidebar (drag source) and content (drop target) */}
        <CalendarDndProvider>
          <CalendarHotkeys />
          <CommandBar />
          <SidebarLeft />
          {responsiveLayout.canShowCalendar ? (
            <SidebarInset>{children}</SidebarInset>
          ) : null}
          <SidebarRight />
        </CalendarDndProvider>
      </SidebarProvider>
    </div>
  );
}
