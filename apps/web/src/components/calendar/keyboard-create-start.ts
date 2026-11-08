import { Temporal } from "temporal-polyfill";

const MORNING = Temporal.PlainTime.from("09:00");

/**
 * Where "c" creates: the next half hour today (never one already under
 * way: 9:30:40 creates at 10:00), or 9 AM tomorrow once today has no half
 * hour left; when today isn't shown, 9 AM on the first visible day (which
 * can be in the past, on a past week). Rounded as a moment in `now`'s
 * zone, so the hour the clocks repeat keeps its own offset.
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
  const next = now.round({
    roundingIncrement: 30,
    roundingMode: "ceil",
    smallestUnit: "minute",
  });
  // Today is over: tomorrow at 9 AM, even if the view has to move there.
  return next.toPlainDate().equals(today)
    ? next
    : morningOf(today.add({ days: 1 }));
}
