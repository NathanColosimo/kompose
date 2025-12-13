"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  currentDateAtom,
  eventWindowAtom,
  timezoneAtom,
  visibleDaysCountAtom,
} from "@/atoms/current-date";
import {
  type GoogleEventWithSource,
  googleAccountsDataAtom,
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@/atoms/google-data";
import { DaysView } from "@/components/calendar/days-view";
import { GoogleAccountsDropdown } from "@/components/calendar/google-accounts-dropdown";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  addDays,
  dateToPlainDate,
  formatPlainDate,
  plainDateToDate,
  subDays,
  todayPlainDate,
} from "@/lib/temporal-utils";
import { orpc } from "@/utils/orpc";

export default function Page() {
  const setCurrentDate = useSetAtom(currentDateAtom);
  const timeZone = useAtomValue(timezoneAtom);
  const visibleDaysCount = useAtomValue(visibleDaysCountAtom);
  const window = useAtomValue(eventWindowAtom);
  const googleAccounts = useAtomValue(googleAccountsDataAtom);
  const googleCalendars = useAtomValue(googleCalendarsDataAtom);
  const visibleGoogleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);

  // Fetch all tasks for the calendar
  const { data: tasks = [], isLoading } = useQuery(
    orpc.tasks.list.queryOptions()
  );

  // Fetch events for each visible calendar within the current window
  const eventsQueries = useQueries({
    queries: visibleGoogleCalendars.map((calendar) => {
      const options = orpc.googleCal.events.list.queryOptions({
        input: {
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
          timeMin: window.timeMin,
          timeMax: window.timeMax,
        },
      });

      return {
        ...options,
        staleTime: 60_000,
        keepPreviousData: true,
      };
    }),
  });

  const googleEvents = useMemo<GoogleEventWithSource[]>(
    () =>
      eventsQueries.flatMap((query, index) => {
        const calendar = visibleGoogleCalendars[index];
        if (!(calendar && query.data)) {
          return [];
        }

        return query.data.map((event) => ({
          event,
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
        }));
      }),
    [eventsQueries, visibleGoogleCalendars]
  );

  // Navigate by visible days count (using functional updates for callback stability)
  const goToPreviousPeriod = useCallback(() => {
    setCurrentDate((prev) => subDays(prev, visibleDaysCount));
  }, [setCurrentDate, visibleDaysCount]);

  const goToNextPeriod = useCallback(() => {
    setCurrentDate((prev) => addDays(prev, visibleDaysCount));
  }, [setCurrentDate, visibleDaysCount]);

  const goToToday = useCallback(() => {
    setCurrentDate(todayPlainDate(timeZone));
  }, [setCurrentDate, timeZone]);

  return (
    <div className="relative h-full">
      {/* Fixed header */}
      <header className="absolute inset-x-0 top-0 z-10 flex h-16 items-center gap-2 border-b bg-background px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-2 data-[orientation=vertical]:h-4"
          orientation="vertical"
        />

        {/* Navigation controls */}
        <div className="flex items-center gap-1">
          <Button onClick={goToPreviousPeriod} size="icon" variant="ghost">
            <ChevronLeft className="size-4" />
          </Button>
          <Button onClick={goToNextPeriod} size="icon" variant="ghost">
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

        <div className="ml-auto">
          <GoogleAccountsDropdown
            googleAccounts={googleAccounts}
            googleCalendars={googleCalendars}
          />
        </div>
      </header>

      {/* Calendar days view - positioned below header */}
      <main className="absolute inset-x-0 top-16 bottom-0">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Loading calendar...
          </div>
        ) : (
          <DaysView googleEvents={googleEvents} tasks={tasks} />
        )}
      </main>
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
          className="w-[280px] justify-start text-left font-normal"
          variant="outline"
        >
          <CalendarIcon />
          {formatPlainDate(currentDate)}
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
