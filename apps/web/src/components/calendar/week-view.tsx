"use client";

import { useDndMonitor } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { format, isToday } from "date-fns";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bufferCenterAtom,
  bufferedDaysAtom,
  currentDateAtom,
  DAYS_BUFFER,
  VISIBLE_DAYS,
} from "@/atoms/current-date";
import { CalendarEvent, GoogleCalendarEvent } from "./calendar-event";
import { PIXELS_PER_HOUR } from "./constants";
import { DayColumn, DayHeader, TimeGutter } from "./time-grid";

/** Default scroll position on mount (8am) */
const DEFAULT_SCROLL_HOUR = 8;

/** Debounce delay for scroll end detection (ms) */
const SCROLL_DEBOUNCE_MS = 150;

/** Threshold for shifting buffer (days from edge) */
const BUFFER_SHIFT_THRESHOLD = VISIBLE_DAYS;

type WeekViewProps = {
  /** All tasks to display (will be filtered to scheduled ones) */
  tasks: TaskSelect[];
  /** Google events (raw from API) to render separately from tasks */
  googleEvents?: GoogleEventWithSource[];
  /** Toggle to show or hide Google events */
  showGoogleEvents?: boolean;
};

export type GoogleEventWithSource = {
  event: GoogleEvent;
  accountId: string;
  calendarId: string;
};

type PositionedGoogleEvent = GoogleEventWithSource & {
  start: Date;
  end: Date;
};

type AllDayGoogleEvent = GoogleEventWithSource & {
  date: Date;
};

function parseDateOnlyLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function buildGoogleEventMaps({
  bufferedDays,
  googleEvents,
  showGoogleEvents,
}: {
  bufferedDays: Date[];
  googleEvents: GoogleEventWithSource[];
  showGoogleEvents: boolean;
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

  if (!showGoogleEvents) {
    return { timedEventsByDay: timed, allDayEventsByDay: allDay };
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

/**
 * WeekView - The main calendar week grid with infinite horizontal scroll.
 * Renders buffered days with CSS scroll-snap for snap-to-day behavior.
 */
export const WeekView = memo(function WeekViewComponent({
  tasks,
  googleEvents = [],
  showGoogleEvents = false,
}: WeekViewProps) {
  const bufferedDays = useAtomValue(bufferedDaysAtom);
  const setBufferCenter = useSetAtom(bufferCenterAtom);
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  // Prevent flicker by pausing scroll-derived updates during programmatic scrolls
  const suppressScrollHandlingRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const isInitialMountRef = useRef(true);
  const [isDraggingEvent, setIsDraggingEvent] = useState(false);

  // Track active drags so we can pause all auto-scroll/snap behavior mid-drag
  useDndMonitor({
    onDragStart: ({ active }) => {
      const data = active.data.current as { type?: string } | undefined;
      if (data?.type === "task" || data?.type === "google-event") {
        setIsDraggingEvent(true);
      }
    },
    onDragCancel: () => {
      setIsDraggingEvent(false);
    },
    onDragEnd: () => {
      setIsDraggingEvent(false);
    },
  });

  // Initial scroll to center (current date) and 8am on mount
  // useLayoutEffect ensures the initial scroll positioning happens before paint,
  // so users never see the buffer jump from midnight to 8am or the wrong day.
  useLayoutEffect(() => {
    if (!(scrollRef.current && isInitialMountRef.current)) {
      return;
    }

    suppressScrollHandlingRef.current = true;

    // Scroll vertically to 8am
    scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR;

    // Scroll horizontally to show buffer center (current date is at index DAYS_BUFFER)
    const dayWidth = scrollRef.current.scrollWidth / bufferedDays.length;
    const targetScrollLeft = DAYS_BUFFER * dayWidth;
    scrollRef.current.scrollLeft = targetScrollLeft;

    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = targetScrollLeft;
    }

    // Allow scroll handling after the initial positioning settles
    programmaticScrollTimeoutRef.current = setTimeout(() => {
      suppressScrollHandlingRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, SCROLL_DEBOUNCE_MS);

    isInitialMountRef.current = false;
  }, [bufferedDays.length]);

  // Track header height (dates + all-day row) to align the gutter corner
  const headerContainerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(49);

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

  // When bufferCenter changes (external navigation), scroll to show the new center
  // We use bufferedDays[DAYS_BUFFER] as the dependency since it IS the center date
  const centerDate = bufferedDays[DAYS_BUFFER];
  const centerDateKey = centerDate ? format(centerDate, "yyyy-MM-dd") : "";
  const prevCenterRef = useRef(centerDateKey);

  // Keep the buffer center aligned before the browser paints to avoid header flicker
  useLayoutEffect(() => {
    if (!scrollRef.current || isInitialMountRef.current) {
      return;
    }

    // Only scroll if the center actually changed (external navigation)
    if (centerDateKey === prevCenterRef.current) {
      return;
    }
    prevCenterRef.current = centerDateKey;

    // Buffer center is always at index DAYS_BUFFER
    const dayWidth = scrollRef.current.scrollWidth / bufferedDays.length;
    const targetScrollLeft = DAYS_BUFFER * dayWidth;

    suppressScrollHandlingRef.current = true;
    scrollRef.current.scrollTo({
      left: targetScrollLeft,
      behavior: "auto", // avoid cross-rail animation; keep header/grid in lockstep
    });
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = targetScrollLeft;
    }

    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = setTimeout(() => {
      suppressScrollHandlingRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, SCROLL_DEBOUNCE_MS);
  }, [centerDateKey, bufferedDays.length]);

  const processScrollEnd = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    // Skip auto-alignment while dragging so the grid never moves unexpectedly
    if (isDraggingEvent) {
      return;
    }

    // During programmatic scrolls, ignore updating currentDate/buffer to avoid flicker
    if (suppressScrollHandlingRef.current) {
      return;
    }

    const dayWidth = container.scrollWidth / bufferedDays.length;
    const dayIndex = Math.round(container.scrollLeft / dayWidth);
    const newCurrentDate = bufferedDays[dayIndex];

    if (!newCurrentDate) {
      return;
    }

    const newDateKey = format(newCurrentDate, "yyyy-MM-dd");
    const currentDateKey = format(currentDate, "yyyy-MM-dd");

    if (newDateKey !== currentDateKey) {
      setCurrentDate(newCurrentDate);
    }

    // Shift buffer if we're getting close to the edges
    const daysFromCenter = dayIndex - DAYS_BUFFER;
    if (Math.abs(daysFromCenter) <= DAYS_BUFFER - BUFFER_SHIFT_THRESHOLD) {
      return;
    }

    suppressScrollHandlingRef.current = true;
    setBufferCenter(newCurrentDate);

    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = setTimeout(() => {
      suppressScrollHandlingRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, SCROLL_DEBOUNCE_MS);
  }, [
    bufferedDays,
    currentDate,
    isDraggingEvent,
    setBufferCenter,
    setCurrentDate,
  ]);

  // Sync header scroll with body scroll and update currentDate on scroll end
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }

    // Sync horizontal scroll between header and body
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }

    // Avoid kicking off any auto scroll handling while dragging an event
    if (isDraggingEvent) {
      return;
    }

    // Debounce scroll end detection to update currentDate
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(processScrollEnd, SCROLL_DEBOUNCE_MS);
  }, [isDraggingEvent, processScrollEnd]);

  // Cleanup timeout on unmount
  useEffect(
    () => () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
      }
    },
    []
  );

  // Filter to only tasks that have startTime (scheduled tasks)
  const scheduledTasks = useMemo(
    () => tasks.filter((task) => task.startTime !== null),
    [tasks]
  );

  // Group scheduled tasks by day for efficient rendering
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, TaskSelect[]>();

    // Initialize all buffered days
    for (const day of bufferedDays) {
      const dayKey = format(day, "yyyy-MM-dd");
      grouped.set(dayKey, []);
    }

    // Group tasks into their respective days
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
  }, [bufferedDays, scheduledTasks]);

  // Group Google events by day (timed vs all-day) and keep them separate from tasks
  const { timedEventsByDay, allDayEventsByDay } = useMemo(
    () =>
      buildGoogleEventMaps({
        bufferedDays,
        googleEvents,
        showGoogleEvents,
      }),
    [bufferedDays, googleEvents, showGoogleEvents]
  );

  // Calculate total width as percentage (each day is 100/VISIBLE_DAYS % of viewport)
  const totalWidthPercent = (bufferedDays.length / VISIBLE_DAYS) * 100;

  // Each day column width as percentage of the parent container (not viewport)
  const dayColumnWidth = `${100 / bufferedDays.length}%`;

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

      {/* Main scrollable area (horizontal + vertical) */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header row - horizontally scrollable (synced with body) */}
        <div
          className="sticky top-0 z-10 shrink-0 overflow-hidden border-b bg-background"
          ref={(node) => {
            headerScrollRef.current = node;
            headerContainerRef.current = node;
          }}
        >
          <div
            className="flex flex-col"
            style={{ width: `${totalWidthPercent}%` }}
          >
            <div className="flex">
              {bufferedDays.map((day) => (
                <DayHeader
                  date={day}
                  isTodayHighlight={isToday(day)}
                  key={format(day, "yyyy-MM-dd")}
                  width={dayColumnWidth}
                />
              ))}
            </div>

            {showGoogleEvents ? (
              <div className="flex border-border border-t border-b bg-background/80">
                {bufferedDays.map((day) => {
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

        {/* Scrollable day columns - horizontal (snap) + vertical, scrollbar hidden */}
        <div
          className="min-h-0 flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={handleScroll}
          ref={scrollRef}
          style={{ scrollSnapType: isDraggingEvent ? "none" : "x mandatory" }}
        >
          <div className="flex" style={{ width: `${totalWidthPercent}%` }}>
            {bufferedDays.map((day, index) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayTasks = tasksByDay.get(dayKey) ?? [];
              const dayGoogleEvents = timedEventsByDay?.get(dayKey) ?? [];
              // Keep only a small window of droppables enabled to reduce measurement cost
              const droppableDisabled =
                Math.abs(index - DAYS_BUFFER) > VISIBLE_DAYS + 1;

              return (
                <DayColumn
                  date={day}
                  droppableDisabled={droppableDisabled}
                  key={dayKey}
                  width={dayColumnWidth}
                >
                  {showGoogleEvents
                    ? dayGoogleEvents.map(
                        ({ event, start, end, accountId, calendarId }) => (
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
                    <CalendarEvent key={task.id} task={task} />
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
