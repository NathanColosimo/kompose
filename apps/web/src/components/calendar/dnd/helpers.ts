import { addMinutes } from "date-fns";
import type { SlotData } from "./types";

export const MINUTES_STEP = 15;
export const MS_PER_MINUTE = 60_000;

export function isSameDayLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function clampDate(value: Date, min: Date, max: Date): Date {
  if (value.getTime() < min.getTime()) {
    return min;
  }
  if (value.getTime() > max.getTime()) {
    return max;
  }
  return value;
}

export function getDayBounds(base: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(base);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

export function clampResizeStart(
  target: Date,
  originalStart: Date,
  originalEnd: Date
): Date {
  const { dayStart } = getDayBounds(originalStart);
  const latestStart = new Date(
    originalEnd.getTime() - MINUTES_STEP * MS_PER_MINUTE
  );
  const clampedToDay = clampDate(target, dayStart, originalEnd);
  return clampedToDay.getTime() > latestStart.getTime()
    ? latestStart
    : clampedToDay;
}

export function clampResizeEnd(target: Date, originalStart: Date): Date {
  const { dayEnd } = getDayBounds(originalStart);
  const earliestEnd = new Date(
    originalStart.getTime() + MINUTES_STEP * MS_PER_MINUTE
  );
  return clampDate(target, earliestEnd, dayEnd);
}

export function durationInMinutes(
  start: Date,
  end: Date,
  minimum: number = MINUTES_STEP
): number {
  return Math.max(
    minimum,
    Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE)
  );
}

export function slotDataToDate(slot: SlotData): Date {
  const dateTime = new Date(slot.date);
  dateTime.setHours(slot.hour, slot.minutes, 0, 0);
  return dateTime;
}

export function shiftMinutes(date: Date, minutes: number): Date {
  return addMinutes(date, minutes);
}
