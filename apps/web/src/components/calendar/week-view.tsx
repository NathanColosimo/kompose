"use client";

import type { TaskSelect } from "@kompose/db/schema/task";
import { format, isToday } from "date-fns";
import { useAtomValue } from "jotai";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { weekDaysAtom } from "@/atoms/current-date";
import type { GoogleEventWithSource } from "@/atoms/google-data";
import { PIXELS_PER_HOUR } from "./constants";
import { GoogleCalendarEvent } from "./events/google-event";
import { TaskEvent } from "./events/task-event";
import { DayColumn } from "./time-grid/day-column";
import { DayHeader } from "./time-grid/day-header";
import { TimeGutter } from "./time-grid/time-gutter";

/** Default scroll position on mount (8am) */
const DEFAULT_SCROLL_HOUR = 8;

type PositionedGoogleEvent = GoogleEventWithSource & {
  start: Date;
  end: Date;
};

type AllDayGoogleEvent = GoogleEventWithSource & { date: Date };

function parseDateOnlyLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function buildGoogleEventMaps({
  bufferedDays,
  googleEvents,
}: {
  bufferedDays: Date[];
  googleEvents: GoogleEventWithSource[];
}): {
  timedEventsByDay: Map<string, PositionedGoogleEvent[]>;
  allDayEventsByDay: Map<string, AllDayGoogleEvent[]>;
} {
  const timed = new Map<string, PositionedGoogleEvent[]>();
  const allDay = new Map<string, AllDayGoogleEvent[]>();

  for (const day of bufferedDays) {
    const key = format(day, "yyyy-MM-dd");
    timed.set(key, []);
    allDay.set(key, []);
  }

  for (const sourceEvent of googleEvents) {
    const startDate = sourceEvent.event.start.date;
    const hasStartDateTime = sourceEvent.event.start.dateTime;
    const hasEndDateTime = sourceEvent.event.end.dateTime;

    if (startDate && !hasStartDateTime && !hasEndDateTime) {
      const parsed = parseDateOnlyLocal(startDate);
      const key = format(parsed, "yyyy-MM-dd");
      const bucket = allDay.get(key);
      if (bucket) {
        bucket.push({ ...sourceEvent, date: parsed });
      }
      continue;
    }

    const positioned = toPositionedGoogleEvent(sourceEvent);
    if (!positioned) {
      continue;
    }

    const dayKey = format(positioned.start, "yyyy-MM-dd");
    const dayEvents = timed.get(dayKey);
    if (dayEvents) {
      dayEvents.push(positioned);
    }
  }

  return { timedEventsByDay: timed, allDayEventsByDay: allDay };
}

function toPositionedGoogleEvent(sourceEvent: GoogleEventWithSource) {
  const startStr =
    sourceEvent.event.start.dateTime ?? sourceEvent.event.start.date;
  const endStr = sourceEvent.event.end.dateTime ?? sourceEvent.event.end.date;

  if (!(startStr && endStr)) {
    return null;
  }

  const start = new Date(startStr);
  const end = new Date(endStr);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return { ...sourceEvent, start, end } satisfies PositionedGoogleEvent;
}

type WeekViewProps = {
  /** All tasks to display (will be filtered to scheduled ones) */
  tasks: TaskSelect[];
  /** Google events (raw from API) to render separately from tasks */
  googleEvents?: GoogleEventWithSource[];
};

/**
 * WeekView - Fixed 7-day view starting from the current date. No horizontal scroll.
 */
export const WeekView = memo(function WeekViewComponent({
  tasks,
  googleEvents = [],
}: WeekViewProps) {
  const weekDays = useAtomValue(weekDaysAtom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerContainerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(49);

  // Scroll vertically to 8am on mount for a sensible default view
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR;
    }
  }, []);

  // Track header height (dates + all-day row) to align the gutter corner
  useLayoutEffect(() => {
    const node = headerContainerRef.current;
    if (!node) {
      return;
    }

    const measure = () => setHeaderHeight(node.offsetHeight || 49);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Filter to only tasks that have startTime (scheduled tasks)
  const scheduledTasks = useMemo(
    () => tasks.filter((task) => task.startTime !== null),
    [tasks]
  );

  // Group scheduled tasks by day for efficient rendering
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, TaskSelect[]>();

    for (const day of weekDays) {
      const dayKey = format(day, "yyyy-MM-dd");
      grouped.set(dayKey, []);
    }

    for (const task of scheduledTasks) {
      if (!task.startTime) {
        continue;
      }
      const taskDate = new Date(task.startTime);
      const dayKey = format(taskDate, "yyyy-MM-dd");
      const dayTasks = grouped.get(dayKey);
      if (dayTasks) {
        dayTasks.push(task);
      }
    }

    return grouped;
  }, [weekDays, scheduledTasks]);

  // Group Google events by day (timed vs all-day) and keep them separate from tasks
  const { timedEventsByDay, allDayEventsByDay } = useMemo(
    () =>
      buildGoogleEventMaps({
        bufferedDays: weekDays,
        googleEvents,
      }),
    [weekDays, googleEvents]
  );

  const hasAllDayEvents = useMemo(
    () =>
      Array.from(allDayEventsByDay.values()).some(
        (eventsForDay) => eventsForDay.length > 0
      ),
    [allDayEventsByDay]
  );

  const hasGoogleEvents = googleEvents.length > 0;

  // Each day column width as percentage of the parent container
  const dayColumnWidth = `${100 / weekDays.length}%`;

  return (
    <div className="flex h-full">
      {/* Fixed time gutter column */}
      <div className="flex w-16 shrink-0 flex-col border-r bg-background">
        {/* Empty corner cell above time gutter - height matches header block */}
        <div className="shrink-0 border-b" style={{ height: headerHeight }} />
        {/* Time gutter - scrolls vertically with the body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <TimeGutterSynced scrollRef={scrollRef} />
        </div>
      </div>

      {/* Main area with vertical scrolling only */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header row */}
        <div
          className="sticky top-0 z-10 shrink-0 overflow-hidden border-b bg-background"
          ref={(node) => {
            headerContainerRef.current = node;
          }}
        >
          <div className="flex flex-col" style={{ width: "100%" }}>
            <div className="flex">
              {weekDays.map((day) => (
                <DayHeader
                  date={day}
                  isTodayHighlight={isToday(day)}
                  key={format(day, "yyyy-MM-dd")}
                  width={dayColumnWidth}
                />
              ))}
            </div>

            {hasAllDayEvents ? (
              <div className="flex border-border border-t border-b bg-background/80">
                {weekDays.map((day) => {
                  const dayKey = format(day, "yyyy-MM-dd");
                  const dayAllDay = allDayEventsByDay.get(dayKey) ?? [];

                  return (
                    <div
                      className="flex min-h-[32px] flex-col items-start gap-1 border-border border-r px-2 pt-1 pb-1 last:border-r-0"
                      key={`${dayKey}-all-day`}
                      style={{ width: dayColumnWidth }}
                    >
                      {dayAllDay.map((item: AllDayGoogleEvent) => (
                        <span
                          className="truncate rounded-sm bg-primary/10 px-1.5 py-0.5 font-medium text-[11px] text-primary"
                          key={`${item.calendarId}-${item.event.id}`}
                          title={item.event.summary ?? "Google event"}
                        >
                          {item.event.summary ?? "Google event"}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {/* Scrollable day columns - vertical only */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ref={scrollRef}
        >
          <div className="flex w-full">
            {weekDays.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayTasks = tasksByDay.get(dayKey) ?? [];
              const dayGoogleEvents = timedEventsByDay?.get(dayKey) ?? [];

              return (
                <DayColumn date={day} key={dayKey} width={dayColumnWidth}>
                  {hasGoogleEvents
                    ? dayGoogleEvents.map(
                        ({ event, start, end, calendarId, accountId }) => (
                          <GoogleCalendarEvent
                            accountId={accountId}
                            calendarId={calendarId}
                            end={end}
                            event={event}
                            key={`${calendarId}-${event.id}-${start.toISOString()}`}
                            start={start}
                          />
                        )
                      )
                    : null}
                  {dayTasks.map((task) => (
                    <TaskEvent key={task.id} task={task} />
                  ))}
                </DayColumn>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * TimeGutterSynced - Time gutter that syncs its vertical scroll with the main scroll area.
 */
function TimeGutterSynced({
  scrollRef,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);

  // Sync vertical scroll position with main scroll area
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      if (gutterRef.current) {
        gutterRef.current.scrollTop = scrollContainer.scrollTop;
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  return (
    <div className="h-full overflow-hidden" ref={gutterRef}>
      <TimeGutter />
    </div>
  );
}

/**
 * Calculate the vertical position and height of an event based on its time.
 * Returns CSS values for top and height.
 */
export function calculateEventPosition(
  startTime: Date,
  durationMinutes: number
): { top: string; height: string } {
  const startHour = startTime.getHours() + startTime.getMinutes() / 60;
  const durationHours = durationMinutes / 60;

  // Grid starts at midnight (hour 0)
  const top = startHour * PIXELS_PER_HOUR;
  const height = durationHours * PIXELS_PER_HOUR;

  return {
    top: `${top}px`,
    height: `${Math.max(height, 24)}px`, // Minimum height of 24px
  };
}

WeekView.displayName = "WeekView";
