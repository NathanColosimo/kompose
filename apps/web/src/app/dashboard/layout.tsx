"use client";

import { CalendarDndProvider } from "@/components/calendar/dnd-context";
import { SidebarLeft } from "@/components/sidebar/sidebar-left";
import { SidebarRight } from "@/components/sidebar/sidebar-right";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  // For mobile visitors we skip the heavy dashboard and show a simple placeholder.
  if (isMobile) {
    return <MobileComingSoon />;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "350px",
        } as React.CSSProperties
      }
    >
      {/* DndContext wraps both sidebar (drag source) and content (drop target) */}
      <CalendarDndProvider>
        <SidebarLeft />
        <SidebarInset>{children}</SidebarInset>
        <SidebarRight />
      </CalendarDndProvider>
    </SidebarProvider>
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
