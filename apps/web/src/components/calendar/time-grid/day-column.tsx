"use client";

import { nowZonedDateTimeAtom } from "@kompose/state/atoms/current-date";
import { useAtomValue } from "jotai";
import { memo } from "react";
import type { Temporal } from "temporal-polyfill";
import { PIXELS_PER_HOUR } from "../constants";
import { currentTimePosition } from "./current-time-position";
import { getHoursRange, SLOT_MINUTES } from "./slot-utils";
import { TimeSlot } from "./time-slot";

interface DayColumnProps {
  children?: React.ReactNode;
  date: Temporal.PlainDate;
  droppableDisabled?: boolean;
  /** Called when mouse moves over a slot during creation drag */
  onSlotDragMove?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse enters a slot (for hover preview) */
  onSlotHover?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse leaves the column area */
  onSlotLeave?: () => void;
  /** Called when mouse down on a slot (start event creation) */
  onSlotMouseDown?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse up on a slot (end event creation) */
  onSlotMouseUp?: () => void;
  timeZone: string;
  width: string;
}

export const DayColumn = memo(function DayColumnInner({
  date,
  timeZone,
  width,
  children,
  droppableDisabled = false,
  onSlotHover,
  onSlotLeave,
  onSlotMouseDown,
  onSlotDragMove,
  onSlotMouseUp,
}: DayColumnProps) {
  const hours = getHoursRange();

  return (
    <div
      className="relative flex shrink-0 flex-col border-border border-r last:border-r-0"
      data-day-column
      style={{ scrollSnapAlign: "start", width }}
    >
      {hours.map((hour) => (
        <div className="relative" key={hour}>
          {SLOT_MINUTES.map((minutes) => (
            <TimeSlot
              date={date}
              droppableDisabled={droppableDisabled}
              hour={hour}
              key={minutes}
              minutes={minutes}
              onSlotDragMove={onSlotDragMove}
              onSlotHover={onSlotHover}
              onSlotLeave={onSlotLeave}
              onSlotMouseDown={onSlotMouseDown}
              onSlotMouseUp={onSlotMouseUp}
              timeZone={timeZone}
            />
          ))}
        </div>
      ))}
      <div className="pointer-events-none absolute inset-0">{children}</div>
      <CurrentTimeIndicator date={date} timeZone={timeZone} />
    </div>
  );
});

function CurrentTimeIndicator({
  date,
  timeZone,
}: Pick<DayColumnProps, "date" | "timeZone">) {
  const now = useAtomValue(nowZonedDateTimeAtom);
  const topPosition = currentTimePosition(date, timeZone, now, PIXELS_PER_HOUR);
  if (topPosition === null) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
      style={{ top: `${topPosition}px`, transform: "translateY(-50%)" }}
    >
      <div className="size-2.5 shrink-0 rounded-full bg-red-500" />
      <div className="h-0.5 flex-1 bg-red-500" />
    </div>
  );
}
