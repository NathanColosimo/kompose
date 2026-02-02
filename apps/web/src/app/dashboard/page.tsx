"use client";

import {
  currentDateAtom,
  eventWindowAtom,
  timezoneAtom,
  visibleDaysCountAtom,
} from "@kompose/state/atoms/current-date";
import {
  type GoogleEventWithSource,
  googleAccountsDataAtom,
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
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
import {
  dateToPlainDate,
  formatPlainDate,
  plainDateToDate,
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

  // Fetch all tasks for the calendar (decoded to Temporal types)
  const {
    tasksQuery: { data: tasks = [], isLoading },
  } = useTasks();

  // Memoize query options to avoid recreating arrays on every render.
  const eventsQueryOptions = useMemo(
    () =>
      visibleGoogleCalendars.map((calendar) => {
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
          placeholderData: keepPreviousData,
        };
      }),
    [visibleGoogleCalendars, window.timeMin, window.timeMax]
  );

  // Fetch events for each visible calendar within the current window
  const eventsQueries = useQueries({
    queries: eventsQueryOptions,
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
    setCurrentDate((prev) => prev.subtract({ days: visibleDaysCount }));
  }, [setCurrentDate, visibleDaysCount]);

  const goToNextPeriod = useCallback(() => {
    setCurrentDate((prev) => prev.add({ days: visibleDaysCount }));
  }, [setCurrentDate, visibleDaysCount]);

  const goToToday = useCallback(() => {
    setCurrentDate(todayPlainDate(timeZone));
  }, [setCurrentDate, timeZone]);

  return (
    <div className="relative h-full">
      {/* Fixed header */}
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-4">
        {/* Navigation controls */}
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

      {/* Calendar days view - positioned below header */}
      <main className="absolute inset-x-0 top-12 bottom-0">
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
