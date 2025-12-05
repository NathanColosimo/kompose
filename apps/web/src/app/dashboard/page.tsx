"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import {
  addDays,
  addWeeks,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  startOfToday,
  subDays,
  subWeeks,
} from "date-fns";
import { useAtom } from "jotai";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { currentDateAtom } from "@/atoms/current-date";
import type { GoogleEventWithSource } from "@/components/calendar/week-view";
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
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const EVENTS_WINDOW_PADDING_DAYS = 15;

function buildEventWindow(center: Date) {
  const monthStart = startOfMonth(center);
  const start = startOfDay(subDays(monthStart, EVENTS_WINDOW_PADDING_DAYS));
  const end = endOfDay(
    addDays(endOfMonth(monthStart), EVENTS_WINDOW_PADDING_DAYS)
  );

  return { start, end, monthStart };
}

export default function Page() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [showGoogleEvents, setShowGoogleEvents] = useState(true);
  const eventWindow = useMemo(
    () => buildEventWindow(currentDate),
    [currentDate]
  );

  const timeRange = useMemo(
    () => ({
      timeMin: eventWindow.start.toISOString(),
      timeMax: eventWindow.end.toISOString(),
    }),
    [eventWindow.end, eventWindow.start]
  );

  // Fetch all tasks for the calendar
  const { data: tasks = [], isLoading } = useQuery(
    orpc.tasks.list.queryOptions()
  );

  // Fetch all linked Google accounts from Better Auth
  const { data: googleAccounts = [] } = useQuery({
    queryKey: ["google-accounts"],
    queryFn: async () => {
      const result = await authClient.listAccounts();
      const accounts = result?.data ?? [];
      return accounts.filter((account) => account.providerId === "google");
    },
  });

  // Fetch calendars for each Google account
  const calendarQueries = useQueries({
    queries: googleAccounts.map((account) => ({
      ...orpc.googleCal.calendars.list.queryOptions({
        input: { accountId: account.id },
      }),
    })),
  });

  const googleCalendars = useMemo(
    () =>
      calendarQueries.flatMap((query, index) => {
        const account = googleAccounts[index];
        if (!(account && query.data)) {
          return [];
        }

        return query.data.map((calendar) => ({
          ...calendar,
          accountId: account.id,
        }));
      }),
    [calendarQueries, googleAccounts]
  );

  // Fetch events for each calendar within a stable ±30d window; keep previous
  // data so buffer shifts never blank the UI while revalidating.
  const eventsQueries = useQueries({
    queries: googleCalendars.map((calendar) => {
      const options = orpc.googleCal.events.list.queryOptions({
        input: {
          accountId: calendar.accountId,
          calendarId: calendar.id,
          timeMin: timeRange.timeMin,
          timeMax: timeRange.timeMax,
        },
      });

      return {
        ...options,
        enabled: showGoogleEvents,
        staleTime: 60_000,
        keepPreviousData: true,
      } as typeof options;
    }),
  });

  const googleEvents = useMemo<GoogleEventWithSource[]>(
    () =>
      eventsQueries.flatMap((query, index) => {
        const calendar = googleCalendars[index];
        if (!(calendar && query.data)) {
          return [];
        }

        return query.data.map((event) => ({
          event,
          accountId: calendar.accountId,
          calendarId: calendar.id,
        }));
      }),
    [eventsQueries, googleCalendars]
  );

  // Navigate to a specific date (updates both currentDate and buffer center)
  const navigateToDate = useCallback(
    (date: Date) => {
      setCurrentDate(date);
    },
    [setCurrentDate]
  );

  // Navigation helpers for week
  const goToPreviousWeek = () => {
    navigateToDate(subWeeks(currentDate, 1));
  };

  const goToNextWeek = () => {
    navigateToDate(addWeeks(currentDate, 1));
  };

  const goToToday = () => {
    navigateToDate(startOfToday());
  };

  return (
    <div className="relative h-full">
      {/* Fixed header */}
      <header className="absolute inset-x-0 top-0 z-10 flex h-16 items-center gap-2 border-b bg-background px-4">
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

        <div className="ml-auto flex items-center gap-2 text-sm">
          <Switch
            checked={showGoogleEvents}
            id="google-events-toggle"
            onCheckedChange={setShowGoogleEvents}
          />
          <label
            className="select-none text-muted-foreground"
            htmlFor="google-events-toggle"
          >
            Google events
          </label>
        </div>
      </header>

      {/* Calendar week view - positioned below header */}
      <main className="absolute inset-x-0 top-16 bottom-0">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Loading calendar...
          </div>
        ) : (
          <WeekView
            googleEvents={googleEvents}
            showGoogleEvents={showGoogleEvents}
            tasks={tasks}
          />
        )}
      </main>
    </div>
  );
}

function DatePopover() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [open, setOpen] = useState(false);

  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      if (date) {
        setCurrentDate(date);
      }
      setOpen(false);
    },
    [setCurrentDate]
  );

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
          onSelect={handleDateSelect}
          required
          selected={currentDate}
        />
      </PopoverContent>
    </Popover>
  );
}
