import { AppSidebar } from "@/components/app-sidebar";
import { SidebarRight } from "@/components/sidebar-right";
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
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
      <SidebarRight />
    </SidebarProvider>
  );
}
