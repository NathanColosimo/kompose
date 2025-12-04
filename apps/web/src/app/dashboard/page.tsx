"use client";

import { useQuery } from "@tanstack/react-query";
import { addWeeks, format, startOfToday, subWeeks } from "date-fns";
import { useAtom } from "jotai";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { currentDateAtom } from "@/atoms/current-date";
import { WeekView } from "@/components/calendar/week-view";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { orpc } from "@/utils/orpc";

export default function Page() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);

  // Fetch all tasks for the calendar
  const { data: tasks = [], isLoading } = useQuery(
    orpc.tasks.list.queryOptions()
  );

  // Navigation helpers for week
  const goToPreviousWeek = () => {
    setCurrentDate(subWeeks(currentDate, 1));
  };

  const goToNextWeek = () => {
    setCurrentDate(addWeeks(currentDate, 1));
  };

  const goToToday = () => {
    setCurrentDate(startOfToday());
  };

  return (
    <div className="relative h-full">
      {/* Fixed header */}
      <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 border-b bg-background px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-2 data-[orientation=vertical]:h-4"
          orientation="vertical"
        />

        {/* Week navigation controls */}
        <div className="flex items-center gap-1">
          <Button onClick={goToPreviousWeek} size="icon" variant="ghost">
            <ChevronLeft className="size-4" />
          </Button>
          <Button onClick={goToNextWeek} size="icon" variant="ghost">
            <ChevronRight className="size-4" />
          </Button>
          <Button
            className="ml-1"
            onClick={goToToday}
            size="sm"
            variant="outline"
          >
            Today
          </Button>
        </div>

        <DatePopover />
      </header>

      {/* Calendar week view - positioned below header */}
      <main className="absolute inset-x-0 top-14 bottom-0">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Loading calendar...
          </div>
        ) : (
          <WeekView tasks={tasks} />
        )}
      </main>
    </div>
  );
}

function DatePopover() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [open, setOpen] = useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="w-[280px] justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
          data-empty={!currentDate}
          variant="outline"
        >
          <CalendarIcon />
          {currentDate ? format(currentDate, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          captionLayout="dropdown"
          mode="single"
          onSelect={(date) => {
            setCurrentDate(date);
            setOpen(false);
          }}
          required
          selected={currentDate}
        />
      </PopoverContent>
    </Popover>
  );
}
