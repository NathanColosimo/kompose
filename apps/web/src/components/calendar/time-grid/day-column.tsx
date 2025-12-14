"use client";

import { memo, useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { isToday } from "@/lib/temporal-utils";
import { PIXELS_PER_HOUR } from "../constants";
import { getHoursRange, SLOT_MINUTES } from "./slot-utils";
import { TimeSlot } from "./time-slot";

type DayColumnProps = {
  date: Temporal.PlainDate;
  timeZone: string;
  width: string;
  children?: React.ReactNode;
  droppableDisabled?: boolean;
};

export const DayColumn = memo(function DayColumnInner({
  date,
  timeZone,
  width,
  children,
  droppableDisabled = false,
}: DayColumnProps) {
  const hours = getHoursRange();
  const isTodayColumn = isToday(date);

  return (
    <div
      className="relative flex shrink-0 flex-col border-border border-r"
      style={{ width, scrollSnapAlign: "start" }}
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
              timeZone={timeZone}
            />
          ))}
        </div>
      ))}
      <div className="pointer-events-none absolute inset-0">{children}</div>
      {isTodayColumn ? <CurrentTimeIndicator /> : null}
    </div>
  );
});

function CurrentTimeIndicator() {
  const [topPosition, setTopPosition] = useState(() => calculateTimePosition());

  useEffect(() => {
    const interval = setInterval(() => {
      setTopPosition(calculateTimePosition());
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

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

/** Calculate the current time indicator position in pixels from top */
function calculateTimePosition(): number {
  const now = Temporal.Now.zonedDateTimeISO();
  return (now.hour + now.minute / 60) * PIXELS_PER_HOUR;
}
