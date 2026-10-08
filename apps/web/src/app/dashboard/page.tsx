"use client";

import {
  currentDateAtom,
  eventWindowAtom,
  timezoneAtom,
} from "@kompose/state/atoms/current-date";
import {
  googleAccountsDataAtom,
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DaysView } from "@/components/calendar/days-view";
import { GoogleAccountsDropdown } from "@/components/calendar/google-accounts-dropdown";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
  todayPlainDate,
} from "@/lib/temporal-utils";
import { effectiveVisibleDaysCountAtom } from "@/state/sidebar";

export default function Page() {
  return <DashboardPageContent />;
}

function DashboardPageContent() {
  const [hydrated, setHydrated] = useState(false);
  const currentDate = useAtomValue(currentDateAtom);
  const effectiveVisibleDaysCount = useAtomValue(effectiveVisibleDaysCountAtom);

  useMountEffect(() => {
    setHydrated(true);
  });

  const effectiveVisibleDays = useMemo(
    () =>
      Array.from({ length: effectiveVisibleDaysCount }, (_, index) =>
        currentDate.add({ days: index })
      ),
    [currentDate, effectiveVisibleDaysCount]
  );

  return (
    <DashboardCalendarContent
      effectiveVisibleDays={effectiveVisibleDays}
      effectiveVisibleDaysCount={effectiveVisibleDaysCount}
      hydrated={hydrated}
    />
  );
}

function DashboardCalendarContent({
  effectiveVisibleDaysCount,
  effectiveVisibleDays,
  hydrated,
}: {
  effectiveVisibleDaysCount: number;
  effectiveVisibleDays: ReturnType<typeof todayPlainDate>[];
  hydrated: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DashboardCalendarToolbar />

      <main className="min-h-0 flex-1">
        {!hydrated || effectiveVisibleDaysCount === 0 ? (
          <CalendarGridPlaceholder />
        ) : (
          <DashboardCalendarGrid effectiveVisibleDays={effectiveVisibleDays} />
        )}
      </main>
    </div>
  );
}

function DashboardCalendarToolbar() {
  const setCurrentDate = useSetAtom(currentDateAtom);
  const timeZone = useAtomValue(timezoneAtom);
  const navigationStep = useAtomValue(effectiveVisibleDaysCountAtom);
  const googleAccounts = useAtomValue(googleAccountsDataAtom);
  const googleCalendars = useAtomValue(googleCalendarsDataAtom);

  // Keep toolbar navigation colocated with the toolbar itself.
  const goToPreviousPeriod = useCallback(() => {
    setCurrentDate((prev) => prev.subtract({ days: navigationStep }));
  }, [navigationStep, setCurrentDate]);

  const goToNextPeriod = useCallback(() => {
    setCurrentDate((prev) => prev.add({ days: navigationStep }));
  }, [navigationStep, setCurrentDate]);

  const goToToday = useCallback(() => {
    setCurrentDate(todayPlainDate(timeZone));
  }, [setCurrentDate, timeZone]);

  return (
    <header className="z-10 flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
      <div className="flex items-center gap-1">
        <Button
          aria-label="Previous period"
          onClick={goToPreviousPeriod}
          size="icon-lg"
          variant="ghost"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          aria-label="Next period"
          onClick={goToNextPeriod}
          size="icon-lg"
          variant="ghost"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          className="ml-1"
          onClick={goToToday}
          size="lg"
          variant="outline"
        >
          Today
        </Button>
      </div>

      <DatePopover />

      <div className="ml-auto flex items-center gap-2">
        <GoogleAccountsDropdown
          googleAccounts={googleAccounts}
          googleCalendars={googleCalendars}
        />
        <ModeToggle />
      </div>
    </header>
  );
}

function DashboardCalendarGrid({
  effectiveVisibleDays,
}: {
  effectiveVisibleDays: ReturnType<typeof todayPlainDate>[];
}) {
  const window = useAtomValue(eventWindowAtom);
  const visibleGoogleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const { tasksQuery } = useTasks();
  const { events: googleEvents } = useGoogleEvents({
    visibleCalendars: visibleGoogleCalendars,
    window,
  });

  const tasks = tasksQuery.data ?? [];

  return (
    <DaysView
      googleEvents={googleEvents}
      tasks={tasks}
      visibleDays={effectiveVisibleDays}
    />
  );
}

function CalendarGridPlaceholder() {
  return (
    <div className="h-full overflow-hidden bg-background">
      <div className="flex h-full">
        <div className="w-16 shrink-0 border-r bg-muted/10" />
        <div className="flex-1">
          <div className="grid h-full grid-rows-[auto_1fr]">
            <div className="border-b bg-muted/5" />
            <div
              className="h-full"
              style={{
                backgroundImage:
                  "linear-gradient(to bottom, hsl(var(--border) / 0.45) 1px, transparent 1px), linear-gradient(to right, hsl(var(--border) / 0.45) 1px, transparent 1px)",
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

function DatePopover() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [open, setOpen] = useState(false);

  const selectedDate = temporalToPickerDate(currentDate);

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
          className="justify-start gap-1.5 px-2.5 text-left font-normal"
          size="lg"
          variant="outline"
        >
          <CalendarIcon className="size-4" />
          <span>{formatPlainDate(currentDate)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          captionLayout="dropdown"
          mode="single"
          onSelect={handleDateSelect}
          required
          selected={selectedDate}
        />
      </PopoverContent>
    </Popover>
  );
}
