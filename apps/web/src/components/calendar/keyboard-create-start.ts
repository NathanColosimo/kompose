import { Temporal } from "temporal-polyfill";

const HALF_HOUR_MINUTES = 30;
const DAY_MINUTES = 24 * 60;
const MORNING_MINUTES = 9 * 60;

/**
 * Where "c" creates: the next half hour today (never one already under
 * way: 9:30:40 creates at 10:00), or 9 AM tomorrow once today has no half
 * hour left; when today isn't shown, 9 AM on the first visible day (which
 * can be in the past, on a past week).
 */
export function keyboardCreateStart({
  now,
  timeZone,
  visibleDays,
}: {
  now: Temporal.ZonedDateTime;
  timeZone: string;
  visibleDays: Temporal.PlainDate[];
}): Temporal.ZonedDateTime {
  const today = now.toPlainDate();
  const at = (day: Temporal.PlainDate, minutes: number) =>
    day.toZonedDateTime({
      plainTime: Temporal.PlainTime.from({
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      }),
      timeZone,
    });
  if (!visibleDays.some((day) => day.equals(today))) {
    return at(visibleDays[0] ?? today, MORNING_MINUTES);
  }
  const minutesIn = now
    .toPlainTime()
    .since(Temporal.PlainTime.from("00:00"))
    .total({ unit: "minutes" });
  const nextHalfHour =
    Math.ceil(minutesIn / HALF_HOUR_MINUTES) * HALF_HOUR_MINUTES;
  return nextHalfHour < DAY_MINUTES
    ? at(today, nextHalfHour)
    : // Today is over: tomorrow at 9 AM, even if the view has to move there.
      at(today.add({ days: 1 }), MORNING_MINUTES);
}
