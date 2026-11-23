import { nearestSlotMinutes } from "@kompose/state/temporal-utils";
import type { Temporal } from "temporal-polyfill";

/** A dragged task snaps to this many minutes. */
const SLOT_MINUTES = 15;

/** How far a dropped task moves: whole days, and minutes within the day. */
export interface TaskMove {
  days: number;
  minutes: number;
}

/**
 * `time` moved by `move`. Days and minutes go on separately: a move right
 * and up mixes signs, which one Temporal duration rejects.
 */
export function moveTime(
  time: Temporal.ZonedDateTime,
  move: TaskMove
): Temporal.ZonedDateTime {
  return time.add({ days: move.days }).add({ minutes: move.minutes });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Where a dragged task lands: the visible day under the finger, and the
 * 15-minute slot nearest its moved top. The grid is 60pt an hour, so the
 * finger's vertical travel in points is minutes. Under half a slot of
 * travel keeps the time as it was.
 */
export function snapTaskMove({
  dayWidth,
  daysAfter,
  daysBefore,
  fingerX,
  startMinutes,
  translationY,
}: {
  /** One day column's width in points. */
  dayWidth: number;
  /** Visible days after the block's day. */
  daysAfter: number;
  /** Visible days before the block's day. */
  daysBefore: number;
  /** The finger's x in points from the left edge of the block's day. */
  fingerX: number;
  /** Minutes from midnight to the block's top on its day. */
  startMinutes: number;
  translationY: number;
}): TaskMove {
  const days = clamp(Math.floor(fingerX / dayWidth), -daysBefore, daysAfter);
  const minutes =
    Math.round(translationY / SLOT_MINUTES) === 0
      ? 0
      : nearestSlotMinutes(startMinutes + translationY) - startMinutes;
  return { days, minutes };
}
