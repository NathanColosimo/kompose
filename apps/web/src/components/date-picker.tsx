"use client";

// biome-ignore lint/performance/noNamespaceImport: Imported Component
import * as React from "react";
import { Calendar } from "@/components/ui/calendar";
import { SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";

export function DatePicker() {
  const [date, setDate] = React.useState<Date | undefined>(new Date());

  return (
    <SidebarGroup className="px-0">
      <SidebarGroupContent>
        <div className="flex justify-center">
          <Calendar
            className="[&_[role=gridcell].bg-accent]:bg-sidebar-primary [&_[role=gridcell].bg-accent]:text-sidebar-primary-foreground **:[[role=gridcell]]:w-[33px]"
            mode="single"
            onSelect={setDate}
            selected={date}
          />
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
