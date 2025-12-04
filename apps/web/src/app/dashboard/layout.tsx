import { CalendarDndProvider } from "@/components/calendar/dnd-context";
import { SidebarLeft } from "@/components/sidebar/sidebar-left";
import { SidebarRight } from "@/components/sidebar/sidebar-right";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
