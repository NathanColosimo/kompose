import { RRuleTemporal } from "rrule-temporal";
import { toText } from "rrule-temporal/totext";
import { Temporal } from "temporal-polyfill";
import {
  type EventRecurrencePattern,
  getPrimaryRecurrenceRule,
  lastWeekdayOf,
  setPositionOf,
  weekdayCodeOf,
} from "./google-event-recurrence";

/** Resolve the days omitted by an RRULE from the series' start. */
function addImplicitDays(
  options: ReturnType<RRuleTemporal["options"]>,
  start: { month: number; day: number; dayOfWeek: number } | undefined
): void {
  if (!start) {
    return;
  }
  if (options.freq === "WEEKLY") {
    options.byDay ??= [weekdayCodeOf(start)];
  }
  if (options.freq === "MONTHLY" && !options.byDay) {
    options.byMonthDay ??= [start.day];
  }
  if (
    options.freq !== "YEARLY" ||
    options.byDay ||
    options.byYearDay ||
    options.byWeekNo ||
    options.byMonthDay
  ) {
    return;
  }
  options.byMonth ??= [start.month];
  options.byMonthDay = [start.day];
}

/** Describes a rule without expanding occurrences or contacting Google. */
export function describeEventRecurrence(params: {
  eventType?: string | null;
  recurringEventId?: string | null;
  rules: string[] | null | undefined;
  start?: { year?: number; month: number; day: number; dayOfWeek: number };
  timeZone?: string;
}): string | null {
  const rule = getPrimaryRecurrenceRule(params.rules);
  if (!rule) {
    if (params.eventType === "birthday") {
      return "Repeats yearly";
    }
    return params.recurringEventId ? "Repeats" : null;
  }
  try {
    const start = params.start;
    const date = Temporal.PlainDate.from({
      year: start?.year ?? 2000,
      month: start?.month ?? 1,
      day: start?.day ?? 1,
    });
    const parsed = new RRuleTemporal({
      rruleString: rule,
      dtstart: date.toZonedDateTime(params.timeZone ?? "UTC"),
      temporal: Temporal,
    });
    const options = parsed.options();
    addImplicitDays(options, start);
    if (params.timeZone && options.until) {
      options.until = options.until.withTimeZone(params.timeZone);
    }
    if (!params.timeZone) {
      options.count = undefined;
      options.until = undefined;
    }
    const described = new RRuleTemporal({ ...options, temporal: Temporal });
    const custom =
      (params.rules ?? []).some(
        (line) => line.startsWith("RDATE") || line.startsWith("EXRULE")
      ) ||
      (params.rules ?? []).filter((line) => line.startsWith("RRULE:")).length >
        1;
    return `Repeats ${toText(described, "en", { excludeTzAbbreviation: true })}${custom ? " (custom)" : ""}`;
  } catch {
    return "Repeats (custom)";
  }
}

function ordinalDayLabel(code: string): string {
  const weekday = code.slice(-2);
  const day = {
    MO: "Mon",
    TU: "Tue",
    WE: "Wed",
    TH: "Thu",
    FR: "Fri",
    SA: "Sat",
    SU: "Sun",
  }[weekday];
  const ordinal = {
    "1": "1st",
    "2": "2nd",
    "3": "3rd",
    "4": "4th",
    "-1": "last",
  }[code.slice(0, -2)];
  return `${ordinal} ${day}`;
}

/** One monthly "On" choice: its label and the BYDAY / BYMONTHDAY it sets. */
interface MonthlyDayOption {
  byDay: string[];
  label: string;
  monthDays: string[];
  selected: boolean;
}

const sameList = (a: string[], b: string[]) => a.join() === b.join();

/**
 * The monthly "On" choices for a series starting on `start`: its day of
 * the month ("Day 27"), its weekday of the month ("The 4th Fri"), and,
 * in its last week, the last one ("The last Fri"), as Google offers. A
 * rule set some other way ("The last weekday", "Day 15") comes first,
 * selected, so opening the editor never changes it.
 */
export function monthlyDayOptions(
  pattern: EventRecurrencePattern,
  rule: string | undefined,
  start: Temporal.PlainDate
): MonthlyDayOption[] {
  const code = weekdayCodeOf(start);
  const nth = Math.ceil(start.day / 7);
  const last = lastWeekdayOf(start);
  const choices = [
    { byDay: [], label: `Day ${start.day}`, monthDays: [] },
    ...(nth <= 4
      ? [
          {
            byDay: [`${nth}${code}`],
            label: `The ${ordinalDayLabel(`${nth}${code}`)}`,
            monthDays: [],
          },
        ]
      : []),
    ...(last
      ? [
          {
            byDay: [last],
            label: `The ${ordinalDayLabel(last)}`,
            monthDays: [],
          },
        ]
      : []),
  ];
  // The rule's own way of saying a choice counts as it ("BYMONTHDAY=7" is
  // Day 7, "BYDAY=SA;BYSETPOS=1" the 1st Sat); picking it then keeps the
  // rule's parts, so it changes nothing.
  const setPos = setPositionOf(rule);
  const sameAs = (choice: { byDay: string[]; monthDays: string[] }) => {
    if (choice.byDay.length === 0) {
      return (
        pattern.byDay.length === 0 &&
        (pattern.monthDays.length === 0 ||
          sameList(pattern.monthDays, [String(start.day)]))
      );
    }
    return (
      pattern.monthDays.length === 0 &&
      (sameList(choice.byDay, pattern.byDay) ||
        (typeof setPos === "string" &&
          sameList(
            choice.byDay,
            pattern.byDay.map((d) => `${setPos}${d}`)
          )))
    );
  };
  const options = choices.map((choice) =>
    sameAs(choice)
      ? {
          byDay: pattern.byDay,
          label: choice.label,
          monthDays: pattern.monthDays,
          selected: true,
        }
      : { ...choice, selected: false }
  );
  if (options.some((option) => option.selected)) {
    return options;
  }
  return [
    {
      byDay: pattern.byDay,
      label:
        describeEventRecurrence({ rules: rule ? [rule] : [], start }) ??
        "Custom days",
      monthDays: pattern.monthDays,
      selected: true,
    },
    ...options,
  ];
}
