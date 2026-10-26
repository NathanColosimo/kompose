import { Temporal } from "temporal-polyfill";

type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** Mirrors `TaskRecurrence` in @kompose/db (packages/db/src/schema/task.ts). */
export type TaskRecurrence = (
  | { freq: "DAILY"; interval: number }
  | { byDay: Weekday[]; freq: "WEEKLY"; interval: number }
  | { byMonthDay: number; freq: "MONTHLY"; interval: number }
  | { freq: "YEARLY"; interval: number }
) & { count?: number; until?: string };

const WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const UTC_TIME_PATTERN = /T(\d{2})(\d{2})(\d{2})Z$/;
const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})/;

/**
 * The task schema's recurrence for an RFC 5545 rule, anchored at the first
 * occurrence `start`. Rules the schema can't express (hourly, "first monday
 * of the month", several days of the month) give null.
 */
export function toTaskRecurrence(
  rrule: string,
  start: Temporal.PlainDate,
  /** The zone a UTC UNTIL ("…T045959Z") is read in. */
  timeZone = "UTC"
): TaskRecurrence | null {
  const parts = ruleParts(rrule);
  if (!parts || unsupported(parts)) {
    return null;
  }
  const repeat = repeatOf(parts, start);
  return repeat && { ...endOf(parts, timeZone), ...repeat };
}

/** The key/value pairs of the RRULE line. */
function ruleParts(rrule: string) {
  const line = rrule
    .split("\n")
    .find((part) => part.startsWith("RRULE:"))
    ?.slice("RRULE:".length);
  if (!line) {
    return null;
  }
  return new Map(
    line.split(";").map((part) => {
      const [key = "", value = ""] = part.split("=");
      return [key, value] as const;
    })
  );
}

function unsupported(parts: Map<string, string>) {
  const freq = parts.get("FREQ");
  const byDay = parts.get("BYDAY")?.split(",") ?? [];
  return (
    parts.has("BYSETPOS") ||
    parts.has("BYHOUR") ||
    parts.has("BYMINUTE") ||
    // Day-of-month and month rules only make sense on monthly/yearly repeats.
    (parts.has("BYMONTHDAY") && freq !== "MONTHLY" && freq !== "YEARLY") ||
    (parts.has("BYMONTH") && freq !== "YEARLY") ||
    // "BYDAY=1MO" (an ordinal weekday) has no schema equivalent.
    byDay.some((day) => !WEEKDAYS.includes(day as Weekday))
  );
}

function repeatOf(
  parts: Map<string, string>,
  start: Temporal.PlainDate
): TaskRecurrence | null {
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const byDay = (parts.get("BYDAY")?.split(",") ?? []) as Weekday[];
  switch (parts.get("FREQ")) {
    case "DAILY":
      return byDay.length > 0
        ? { byDay, freq: "WEEKLY", interval }
        : { freq: "DAILY", interval };
    case "WEEKLY": {
      const startDay = WEEKDAYS[start.dayOfWeek - 1] as Weekday;
      return {
        byDay: byDay.length > 0 ? byDay : [startDay],
        freq: "WEEKLY",
        interval,
      };
    }
    case "MONTHLY": {
      const days = parts.get("BYMONTHDAY")?.split(",") ?? [];
      const day = days[0] ? Number(days[0]) : start.day;
      // Weekday-based months, several days, and negative days ("last day of
      // the month") don't fit the schema.
      return byDay.length > 0 || days.length > 1 || day < 1
        ? null
        : { byMonthDay: day, freq: "MONTHLY", interval };
    }
    case "YEARLY":
      return byDay.length > 0 ? null : { freq: "YEARLY", interval };
    default:
      return null;
  }
}

function endOf(parts: Map<string, string>, timeZone: string) {
  const count = parts.get("COUNT");
  if (count) {
    return { count: Number(count) };
  }
  const value = parts.get("UNTIL") ?? "";
  const until = UNTIL_PATTERN.exec(value);
  if (!until) {
    return {};
  }
  const date = `${until[1]}-${until[2]}-${until[3]}`;
  const clock = UTC_TIME_PATTERN.exec(value);
  // "until dec 20" in New York ends at 23:59 local, which is Dec 21 in UTC.
  return clock
    ? {
        until: Temporal.Instant.from(
          `${date}T${clock[1]}:${clock[2]}:${clock[3]}Z`
        )
          .toZonedDateTimeISO(timeZone)
          .toPlainDate()
          .toString(),
      }
    : { until: date };
}
