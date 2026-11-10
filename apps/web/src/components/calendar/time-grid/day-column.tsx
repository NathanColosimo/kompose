"use client";

import { useDroppable } from "@dnd-kit/core";
import { nowZonedDateTimeAtom } from "@kompose/state/atoms/current-date";
import { atom, useAtomValue } from "jotai";
import { memo, useMemo } from "react";
import type { Temporal } from "temporal-polyfill";
import { PIXELS_PER_HOUR, SLOT_HEIGHT } from "../constants";
import { dropSlotAtom } from "../dnd/day-column-slots";
import type { DayColumnDropData } from "../dnd/types";
import { getHoursRange, SLOT_MINUTES } from "./slot-utils";
import { TimeSlot } from "./time-slot";

/**
 * The free strip at a column's right edge, in pixels: blocks stop short of
 * it, so a slot is always free to start a new event even on a busy day.
 */
export const COLUMN_FREE_STRIP = 12;

interface DayColumnProps {
  /** The column's blocks. */
  children?: React.ReactNode;
  date: Temporal.PlainDate;
  onSlotDragMove?: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotHover?: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotLeave?: () => void;
  onSlotMouseDown?: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotMouseUp?: () => void;
  /** Drawn above every block, such as the new-event preview. */
  overlay?: React.ReactNode;
  timeZone: string;
  width: string;
}

export const DayColumn = memo(function DayColumnInner({
  date,
  timeZone,
  width,
  children,
  onSlotHover,
  onSlotLeave,
  onSlotMouseDown,
  onSlotDragMove,
  onSlotMouseUp,
  overlay,
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
      <DayColumnDropTarget date={date} timeZone={timeZone} />
      {/* Blocks stop short of the right edge (COLUMN_FREE_STRIP). Their
          stacking order stays
          inside this layer (isolate), so a busy day's blocks never rise
          above the overlay, the now line, or the grid's header. */}
      {/* The now line runs under the blocks, so it never strikes through a
          title; its dot stays on top at the column's edge. */}
      <CurrentTimeIndicator date={date} part="line" />
      <div
        className="pointer-events-none absolute inset-y-0 left-0 isolate"
        style={{ right: COLUMN_FREE_STRIP }}
      >
        {children}
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 left-0"
        style={{ right: COLUMN_FREE_STRIP }}
      >
        {overlay}
      </div>
      <CurrentTimeIndicator date={date} part="dot" />
    </div>
  );
});

/**
 * The column's one droppable, covering exactly the slot area. The highlight
 * re-renders only when the hovered slot in this column changes.
 */
function DayColumnDropTarget({
  date,
  timeZone,
}: {
  date: Temporal.PlainDate;
  timeZone: string;
}) {
  // dnd-kit keeps `data` in a ref, so a new object per render is fine.
  const { setNodeRef } = useDroppable({
    data: { date, timeZone, type: "day-column" } satisfies DayColumnDropData,
    id: `day-column-${date}`,
  });
  const highlightIndexAtom = useMemo(
    () =>
      atom((get) => {
        const slot = get(dropSlotAtom);
        return slot?.column.date.equals(date) ? slot.index : null;
      }),
    [date]
  );
  const highlightIndex = useAtomValue(highlightIndexAtom);

  return (
    <div className="pointer-events-none absolute inset-0" ref={setNodeRef}>
      {highlightIndex === null ? null : (
        <div
          className="absolute inset-x-0 bg-primary/10"
          style={{ height: SLOT_HEIGHT, top: highlightIndex * SLOT_HEIGHT }}
        />
      )}
    </div>
  );
}

/** The now line, in the displayed time zone; it moves columns at midnight. */
function CurrentTimeIndicator({
  date,
  part,
}: {
  date: Temporal.PlainDate;
  part: "dot" | "line";
}) {
  const now = useAtomValue(nowZonedDateTimeAtom);
  if (!now.toPlainDate().equals(date)) {
    return null;
  }
  const topPosition = (now.hour + now.minute / 60) * PIXELS_PER_HOUR;

  return (
    <div
      className="pointer-events-none absolute right-0 left-0 flex items-center"
      style={{ top: `${topPosition}px`, transform: "translateY(-50%)" }}
    >
      {part === "dot" ? (
        <div className="size-2.5 shrink-0 rounded-full bg-red-500" />
      ) : (
        <div className="h-0.5 flex-1 bg-red-500" />
      )}
    </div>
  );
}
