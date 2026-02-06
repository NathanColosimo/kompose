"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppHeader } from "@/components/app-header";
import { CalendarDndProvider } from "@/components/calendar/dnd-context";
import { CommandBar } from "@/components/command-bar/command-bar";
import { CalendarHotkeys } from "@/components/hotkeys/calendar-hotkeys";
import { SidebarLeft } from "@/components/sidebar/sidebar-left";
import { SidebarRight } from "@/components/sidebar/sidebar-right";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { useIsMobile } from "@/lib/use-mobile";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const isMobile = useIsMobile();

  // Redirect visitors without an active session back to the homepage.
  useEffect(() => {
    if (!(isPending || session)) {
      router.replace("/");
    }
  }, [isPending, router, session]);

  // Avoid rendering dashboard UI while we validate or redirect.
  if (isPending || !session) {
    return null;
  }

  // For mobile visitors we skip the heavy dashboard and show a simple placeholder.
  if (isMobile) {
    return <MobileComingSoon />;
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
      <AppHeader />

      {/* Main content area below header */}
      <SidebarProvider
        className="min-h-0 flex-1"
        style={
          {
            "--sidebar-width": "350px",
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

function MobileComingSoon() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-muted px-6 text-center">
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Kompose dashboard
      </p>
      <h1 className="font-semibold text-2xl">Mobile coming soon</h1>
      <p className="max-w-sm text-muted-foreground text-sm">
        We are focusing on the desktop experience right now. Please open the
        dashboard on a larger screen to keep working.
      </p>
    </div>
  );
}
