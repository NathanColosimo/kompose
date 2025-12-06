"use client";

import { format, setHours, setMinutes } from "date-fns";
import { MINUTES_STEP } from "../dnd/helpers";

export const SLOT_ID_REGEX = /^slot-(\d{4}-\d{2}-\d{2})-(\d+)-(\d{1,2})$/;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const SLOT_MINUTES = [
  0,
  MINUTES_STEP,
  MINUTES_STEP * 2,
  MINUTES_STEP * 3,
];

export function getHoursRange(): number[] {
  return HOURS;
}

export function buildSlotId(date: Date, hour: number, minutes: number): string {
  return `slot-${format(date, "yyyy-MM-dd")}-${hour}-${minutes}`;
}

export function parseSlotId(slotId: string): Date | null {
  const match = slotId.match(SLOT_ID_REGEX);
  if (!match) {
    return null;
  }

  const [, dateStr, hourStr, minutesStr] = match;
  const [year, month, day] = dateStr.split("-").map(Number);
  const hour = Number.parseInt(hourStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);

  // Create date in local timezone
  return new Date(year, month - 1, day, hour, minutes, 0, 0);
}

export function formatHourLabel(hour: number): string {
  return format(setMinutes(setHours(new Date(), hour), 0), "h a");
}
