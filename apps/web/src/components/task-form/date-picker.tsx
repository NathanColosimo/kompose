"use client";

import { Calendar } from "@/components/ui/calendar";
import { SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";

type DatePickerProps = {
  initialDate: Date;
  setDate: (date: Date | undefined) => void;
};

export function DatePicker({ initialDate, setDate }: DatePickerProps) {
  return (
    <SidebarGroup className="px-0">
      <SidebarGroupContent>
        <div className="flex justify-center">
          <Calendar
            className="[&_[role=gridcell].bg-accent]:bg-sidebar-primary [&_[role=gridcell].bg-accent]:text-sidebar-primary-foreground **:[[role=gridcell]]:w-[33px]"
            mode="single"
            onSelect={setDate}
            selected={initialDate}
          />
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
