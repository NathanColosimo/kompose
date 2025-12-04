"use client";

import type { TaskSelect } from "@kompose/db/schema/task";
import { isToday } from "date-fns";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import { weekDaysAtom } from "@/atoms/current-date";
import { CalendarEvent } from "./calendar-event";
import { DayColumn, DayHeader, TimeGutter } from "./time-grid";

/** Pixels per hour (2 slots × 40px each) */
const PIXELS_PER_HOUR = 80;

/** Default scroll position on mount (8am) */
const DEFAULT_SCROLL_HOUR = 8;

type WeekViewProps = {
  /** All tasks to display (will be filtered to scheduled ones) */
  tasks: TaskSelect[];
};

/**
 * WeekView - The main calendar week grid displaying 7 days with time slots.
 * Renders scheduled tasks as positioned CalendarEvent blocks.
 */
export function WeekView({ tasks }: WeekViewProps) {
  const weekDays = useAtomValue(weekDaysAtom);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to 8am on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR;
    }
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
      const dayKey = day.toISOString().split("T")[0];
      grouped.set(dayKey, []);
    }

    for (const task of scheduledTasks) {
      if (!task.startTime) {
        continue;
      }
      const taskDate = new Date(task.startTime);
      const dayKey = taskDate.toISOString().split("T")[0];
      const dayTasks = grouped.get(dayKey);
      if (dayTasks) {
        dayTasks.push(task);
      }
    }

    return grouped;
  }, [weekDays, scheduledTasks]);

  return (
    <div className="flex h-full flex-col">
      {/* Fixed header row with day names and dates */}
      <div className="flex shrink-0 border-b bg-background">
        {/* Empty corner cell above time gutter */}
        <div className="w-16 shrink-0 border-r" />
        {/* Day headers */}
        {weekDays.map((day) => (
          <DayHeader
            date={day}
            isToday={isToday(day)}
            key={day.toISOString()}
          />
        ))}
      </div>

      {/* Scrollable time grid area - only this part scrolls */}
      <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="flex">
          {/* Time gutter (hours column) */}
          <TimeGutter className="border-r" />

          {/* Day columns */}
          {weekDays.map((day) => {
            const dayKey = day.toISOString().split("T")[0];
            const dayTasks = tasksByDay.get(dayKey) ?? [];

            return (
              <DayColumn date={day} key={day.toISOString()}>
                {/* Render positioned events for this day */}
                {dayTasks.map((task) => (
                  <CalendarEvent key={task.id} task={task} />
                ))}
              </DayColumn>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Calculate the vertical position and height of an event based on its time.
 * Returns CSS values for top and height.
 */
export function calculateEventPosition(
  startTime: Date,
  endTime: Date
): { top: string; height: string } {
  const startHour = startTime.getHours() + startTime.getMinutes() / 60;
  const endHour = endTime.getHours() + endTime.getMinutes() / 60;

  // Grid starts at midnight (hour 0)
  const top = startHour * PIXELS_PER_HOUR;
  const height = (endHour - startHour) * PIXELS_PER_HOUR;

  return {
    top: `${top}px`,
    height: `${Math.max(height, 24)}px`, // Minimum height of 24px
  };
}
