/** A dragged task snaps to this many minutes. */
const SLOT_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

/** How far a dropped task moves: whole days, and minutes within the day. */
export interface TaskMove {
  days: number;
  minutes: number;
}

/**
 * `time` moved by `move`. Days and minutes go on separately: a move right
 * and up mixes signs, which one Temporal duration rejects.
 */
export function moveTime<
  T extends { add: (duration: { days?: number; minutes?: number }) => T },
>(time: T, move: TaskMove): T {
  return time.add({ days: move.days }).add({ minutes: move.minutes });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Where a dragged task lands. The grid is 60pt an hour, so the finger's
 * vertical travel in points is minutes. The move snaps to whole day
 * columns and 15-minute steps, and keeps the block on the visible days
 * with its top inside the day.
 */
export function snapTaskMove({
  dayWidth,
  daysAfter,
  daysBefore,
  startMinutes,
  translationX,
  translationY,
}: {
  /** One day column's width in points. */
  dayWidth: number;
  /** Visible days after the block's day. */
  daysAfter: number;
  /** Visible days before the block's day. */
  daysBefore: number;
  /** Minutes from midnight to the block's top on its day. */
  startMinutes: number;
  translationX: number;
  translationY: number;
}): TaskMove {
  // `|| 0` turns Math.round's -0 into 0, so an unmoved drag equals no move.
  const days =
    clamp(Math.round(translationX / dayWidth), -daysBefore, daysAfter) || 0;
  const minutes =
    clamp(
      Math.round(translationY / SLOT_MINUTES) * SLOT_MINUTES,
      -startMinutes,
      DAY_MINUTES - SLOT_MINUTES - startMinutes
    ) || 0;
  return { days, minutes };
}
