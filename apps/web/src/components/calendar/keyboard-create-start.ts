import { Temporal } from "temporal-polyfill";

const MORNING = Temporal.PlainTime.from("09:00");

/**
 * Where "c" creates: the next half hour today (never one already under
 * way: 9:30:40 creates at 10:00), or 9 AM tomorrow once today has no half
 * hour left; when today isn't shown, 9 AM on the first visible day (which
 * can be in the past, on a past week). Never a time the editor would save
 * as an earlier moment: in the second 1 AM as the clocks fall back, 1:10
 * creates at 2:00.
 */
export function keyboardCreateStart({
  now,
  visibleDays,
}: {
  now: Temporal.ZonedDateTime;
  visibleDays: Temporal.PlainDate[];
}): Temporal.ZonedDateTime {
  const today = now.toPlainDate();
  const morningOf = (day: Temporal.PlainDate) =>
    day.toZonedDateTime({ plainTime: MORNING, timeZone: now.timeZoneId });
  if (!visibleDays.some((day) => day.equals(today))) {
    return morningOf(visibleDays[0] ?? today);
  }
  let next = now.round({
    roundingIncrement: 30,
    roundingMode: "ceil",
    smallestUnit: "minute",
  });
  // The editor's form keeps a date and a wall time, which saves as its
  // first occurrence: in the second copy of an hour the clocks repeat,
  // start after it instead.
  while (!savesAsItself(next)) {
    next = next.add({ minutes: 30 });
  }
  // Today is over: tomorrow at 9 AM, even if the view has to move there.
  return next.toPlainDate().equals(today)
    ? next
    : morningOf(today.add({ days: 1 }));
}

/**
 * Whether `time`'s wall time names `time` itself, as the editor's form
 * reads it back (a repeated wall time resolves to its first occurrence).
 */
function savesAsItself(time: Temporal.ZonedDateTime): boolean {
  return time.toPlainDateTime().toZonedDateTime(time.timeZoneId).equals(time);
}
