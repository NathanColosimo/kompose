"use client";

import {
  currentDateAtom,
  eventWindowAtom,
  timezoneAtom,
  visibleDaysCountAtom,
} from "@kompose/state/atoms/current-date";
import {
  googleAccountsDataAtom,
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { sessionQueryAtom } from "@kompose/state/config";
import {
  GOOGLE_ACCOUNTS_QUERY_KEY,
  GOOGLE_CALENDARS_QUERY_KEY,
} from "@kompose/state/google-calendar-query-keys";
import { useDashboardBootstrap } from "@kompose/state/hooks/use-dashboard-bootstrap";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useIsFetching } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  dateToPlainDate,
  formatPlainDate,
  plainDateToDate,
  todayPlainDate,
} from "@/lib/temporal-utils";
import {
  dashboardResponsiveLayoutAtom,
  dashboardViewportWidthAtom,
} from "@/state/sidebar";

export default function Page() {
  const window = useAtomValue(eventWindowAtom);
  const viewportWidth = useAtomValue(dashboardViewportWidthAtom);
  useDashboardBootstrap({
    enabled: viewportWidth > 0,
    window,
  });

  return <DashboardPageContent />;
}

function DashboardPageContent() {
  const [hydrated, setHydrated] = useState(false);
  const currentDate = useAtomValue(currentDateAtom);
  const visibleDaysCount = useAtomValue(visibleDaysCountAtom);
  const responsiveLayout = useAtomValue(dashboardResponsiveLayoutAtom);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const effectiveVisibleDaysCount = useMemo(
    () =>
      Math.max(
        1,
        Math.min(visibleDaysCount, responsiveLayout.maxDaysForCurrentLayout)
      ),
    [responsiveLayout.maxDaysForCurrentLayout, visibleDaysCount]
  );

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
    <div className="relative h-full">
      <DashboardCalendarToolbar />

      <main className="absolute inset-x-0 top-12 bottom-0">
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
  const visibleDaysCount = useAtomValue(visibleDaysCountAtom);
  const responsiveLayout = useAtomValue(dashboardResponsiveLayoutAtom);
  const googleAccounts = useAtomValue(googleAccountsDataAtom);
  const googleCalendars = useAtomValue(googleCalendarsDataAtom);
  const navigationStep = Math.max(
    1,
    Math.min(visibleDaysCount, responsiveLayout.maxDaysForCurrentLayout)
  );

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
    <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-4">
      <div className="flex items-center gap-1">
        <Button onClick={goToPreviousPeriod} size="icon-lg" variant="ghost">
          <ChevronLeft className="size-4" />
        </Button>
        <Button onClick={goToNextPeriod} size="icon-lg" variant="ghost">
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
  const sessionQuery = useAtomValue(sessionQueryAtom);
  const window = useAtomValue(eventWindowAtom);
  const visibleGoogleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const accountFetchCount = useIsFetching({
    queryKey: GOOGLE_ACCOUNTS_QUERY_KEY,
  });
  const calendarFetchCount = useIsFetching({
    queryKey: GOOGLE_CALENDARS_QUERY_KEY,
  });
  const { tasksQuery } = useTasks();
  const { events: googleEvents, isLoading: isGoogleEventsLoading } =
    useGoogleEvents({
      visibleCalendars: visibleGoogleCalendars,
      window,
    });
  const tasks = tasksQuery.data ?? [];
  const isCalendarLoading =
    sessionQuery.status === "pending" ||
    (tasksQuery.data === undefined && tasksQuery.error == null) ||
    accountFetchCount > 0 ||
    calendarFetchCount > 0 ||
    isGoogleEventsLoading;

  if (isCalendarLoading) {
    return <CalendarGridPlaceholder />;
  }

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
  const timeZone = useAtomValue(timezoneAtom);
  const [open, setOpen] = useState(false);

  // Convert to Date for react-day-picker
  const selectedDate = plainDateToDate(currentDate, timeZone);

  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      if (date) {
        // Convert from Date back to PlainDate
        setCurrentDate(dateToPlainDate(date, timeZone));
      }
      setOpen(false);
    },
    [setCurrentDate, timeZone]
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
