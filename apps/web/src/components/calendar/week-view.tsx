"use client";

import type { TaskSelect } from "@kompose/db/schema/task";
import { format, isToday } from "date-fns";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  bufferCenterAtom,
  bufferedDaysAtom,
  currentDateAtom,
  DAYS_BUFFER,
  VISIBLE_DAYS,
} from "@/atoms/current-date";
import { CalendarEvent } from "./calendar-event";
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
};

/**
 * WeekView - The main calendar week grid with infinite horizontal scroll.
 * Renders buffered days with CSS scroll-snap for snap-to-day behavior.
 */
export function WeekView({ tasks }: WeekViewProps) {
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
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        const newDayWidth = scrollRef.current.scrollWidth / bufferedDays.length;
        scrollRef.current.scrollLeft = DAYS_BUFFER * newDayWidth;
        if (headerScrollRef.current) {
          headerScrollRef.current.scrollLeft = DAYS_BUFFER * newDayWidth;
        }
      }
    });

    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = setTimeout(() => {
      suppressScrollHandlingRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, SCROLL_DEBOUNCE_MS);
  }, [bufferedDays, currentDate, setBufferCenter, setCurrentDate]);

  // Sync header scroll with body scroll and update currentDate on scroll end
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }

    // Sync horizontal scroll between header and body
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }

    // Debounce scroll end detection to update currentDate
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(processScrollEnd, SCROLL_DEBOUNCE_MS);
  }, [processScrollEnd]);

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

  // Calculate total width as percentage (each day is 100/VISIBLE_DAYS % of viewport)
  const totalWidthPercent = (bufferedDays.length / VISIBLE_DAYS) * 100;

  // Each day column width as percentage of the parent container (not viewport)
  const dayColumnWidth = `${100 / bufferedDays.length}%`;

  return (
    <div className="flex h-full">
      {/* Fixed time gutter column */}
      <div className="flex w-16 shrink-0 flex-col border-r bg-background">
        {/* Empty corner cell above time gutter - h-[49px] matches header row (h-12 + border-b) */}
        <div className="h-[49px] shrink-0 border-b" />
        {/* Time gutter - scrolls vertically with the body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <TimeGutterSynced scrollRef={scrollRef} />
        </div>
      </div>

      {/* Main scrollable area (horizontal + vertical) */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header row - horizontally scrollable (synced with body) */}
        <div
          className="shrink-0 overflow-hidden border-b bg-background"
          ref={headerScrollRef}
        >
          <div className="flex" style={{ width: `${totalWidthPercent}%` }}>
            {bufferedDays.map((day) => (
              <DayHeader
                date={day}
                isTodayHighlight={isToday(day)}
                key={format(day, "yyyy-MM-dd")}
                width={dayColumnWidth}
              />
            ))}
          </div>
        </div>

        {/* Scrollable day columns - horizontal (snap) + vertical, scrollbar hidden */}
        <div
          className="min-h-0 flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={handleScroll}
          ref={scrollRef}
          style={{ scrollSnapType: "x mandatory" }}
        >
          <div className="flex" style={{ width: `${totalWidthPercent}%` }}>
            {bufferedDays.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayTasks = tasksByDay.get(dayKey) ?? [];

              return (
                <DayColumn date={day} key={dayKey} width={dayColumnWidth}>
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
}

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
