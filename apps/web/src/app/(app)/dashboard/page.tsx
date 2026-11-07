"use client";

import {
  currentDateAtom,
  eventWindowsAtom,
} from "@kompose/state/atoms/current-date";
import {
  googleAccountsDataAtom,
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { todayPlainDate } from "@kompose/state/temporal-utils";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { DaysView } from "@/components/calendar/days-view";
import { GoogleAccountsDropdown } from "@/components/calendar/google-accounts-dropdown";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  pickerDateToTemporal,
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { goToTodayAtom } from "@/state/calendar-navigation";
import { effectiveVisibleDaysCountAtom } from "@/state/sidebar";

export default function Page() {
  const [hydrated, setHydrated] = useState(false);

  useMountEffect(() => {
    setHydrated(true);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DashboardCalendarToolbar />

      <main className="min-h-0 flex-1">
        {hydrated ? <DashboardCalendarGrid /> : <CalendarGridPlaceholder />}
      </main>
    </div>
  );
}

function DashboardCalendarToolbar() {
  const setCurrentDate = useSetAtom(currentDateAtom);
  const goToToday = useSetAtom(goToTodayAtom);
  const navigationStep = useAtomValue(effectiveVisibleDaysCountAtom);
  const googleAccounts = useAtomValue(googleAccountsDataAtom);
  const googleCalendars = useAtomValue(googleCalendarsDataAtom);

  const goToPreviousPeriod = useCallback(() => {
    setCurrentDate((prev) => prev.subtract({ days: navigationStep }));
  }, [navigationStep, setCurrentDate]);

  const goToNextPeriod = useCallback(() => {
    setCurrentDate((prev) => prev.add({ days: navigationStep }));
  }, [navigationStep, setCurrentDate]);

  return (
    <header className="z-10 flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b bg-background px-3 py-2">
      <Button onClick={goToToday} size="lg" variant="outline">
        Today
      </Button>
      <div className="flex items-center">
        <Button
          aria-label="Previous days"
          className="text-muted-foreground"
          onClick={goToPreviousPeriod}
          size="icon-lg"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-label="Next days"
          className="text-muted-foreground"
          onClick={goToNextPeriod}
          size="icon-lg"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
      </div>

      <DatePopover />

      <div className="ml-auto flex items-center">
        <GoogleAccountsDropdown
          googleAccounts={googleAccounts}
          googleCalendars={googleCalendars}
        />
      </div>
    </header>
  );
}

function DashboardCalendarGrid() {
  const windows = useAtomValue(eventWindowsAtom);
  const visibleGoogleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const { tasksQuery } = useTasks();
  const { events: googleEvents } = useGoogleEvents({
    visibleCalendars: visibleGoogleCalendars,
    windows,
  });

  const tasks = tasksQuery.data ?? [];

  return <DaysView googleEvents={googleEvents} tasks={tasks} />;
}

function CalendarGridPlaceholder() {
  return (
    <div className="h-full overflow-hidden bg-background">
      <div className="flex h-full">
        <div className="w-16 shrink-0 border-r" />
        <div className="flex-1">
          <div className="grid h-full grid-rows-[auto_1fr]">
            <div className="h-12 border-b" />
            <div
              className="h-full"
              style={{
                backgroundImage:
                  "linear-gradient(to bottom, color-mix(in oklab, var(--border) 60%, transparent) 1px, transparent 1px), linear-gradient(to right, color-mix(in oklab, var(--border) 60%, transparent) 1px, transparent 1px)",
                backgroundPosition: "0 0, 0 0",
                backgroundSize: "100% 80px, 160px 100%",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Formats a range as "November 2026", or "October – November 2026" across months. */
const monthYearFormat = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

/** How many years before and after today the date picker's year dropdown spans. */
const PICKER_YEAR_SPAN = 100;

function DatePopover() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const visibleDaysCount = useAtomValue(effectiveVisibleDaysCountAtom);
  const [open, setOpen] = useState(false);

  const selectedDate = temporalToPickerDate(currentDate);
  // react-day-picker's dropdown stops at the end of the current year by default.
  const thisYear = todayPlainDate().year;
  const startMonth = new Date(thisYear - PICKER_YEAR_SPAN, 0);
  const endMonth = new Date(thisYear + PICKER_YEAR_SPAN, 11);

  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      if (date) {
        setCurrentDate(pickerDateToTemporal(date));
      }
      setOpen(false);
    },
    [setCurrentDate]
  );

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="gap-1.5 px-2 font-medium text-base"
          size="lg"
          variant="ghost"
        >
          {monthYearFormat.formatRange(
            selectedDate,
            temporalToPickerDate(
              currentDate.add({ days: visibleDaysCount - 1 })
            )
          )}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          captionLayout="dropdown"
          defaultMonth={selectedDate}
          endMonth={endMonth}
          mode="single"
          onSelect={handleDateSelect}
          required
          selected={selectedDate}
          startMonth={startMonth}
        />
      </PopoverContent>
    </Popover>
  );
}
