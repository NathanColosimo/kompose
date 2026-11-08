import { Temporal } from "temporal-polyfill";

const MORNING = Temporal.PlainTime.from("09:00");

/**
 * Where "c" creates: the next half hour today (never one already under
 * way: 9:30:40 creates at 10:00), or 9 AM tomorrow once today has no half
 * hour left; when today isn't shown, 9 AM on the first visible day (which
 * can be in the past, on a past week). Never a time in the hour the
 * clocks repeat as they fall back (1:10 AM there creates at 2:00 AM).
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
  // The editor's form keeps a date and a wall time, which can't say which
  // of an hour the clocks repeat is meant: start after it instead.
  while (isRepeatedTime(next)) {
    next = next.add({ minutes: 30 });
  }
  // Today is over: tomorrow at 9 AM, even if the view has to move there.
  return next.toPlainDate().equals(today)
    ? next
    : morningOf(today.add({ days: 1 }));
}

/** Whether `time`'s wall time happens twice in its zone (clocks falling back). */
function isRepeatedTime(time: Temporal.ZonedDateTime): boolean {
  const wall = time.toPlainDateTime();
  const at = (disambiguation: "earlier" | "later") =>
    wall.toZonedDateTime(time.timeZoneId, { disambiguation }).epochNanoseconds;
  return at("earlier") !== at("later");
}
