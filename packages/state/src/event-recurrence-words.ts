/**
 * A Google event's repeat in words ("Repeats every 2 weeks on Tue"), and
 * the monthly "On" choices the repeat editors offer.
 */
import type { Temporal } from "temporal-polyfill";
import {
  type EventRecurrenceEnd,
  type EventRecurrencePattern,
  GOOGLE_EVENT_WEEKDAYS,
  getPrimaryRecurrenceRule,
  isPlainWeekday,
  lastWeekdayOf,
  parseGoogleEventRecurrenceRule,
  recurrenceEndDay,
  setPositionOf,
  weekdayCodeOf,
  weekOrdered,
} from "./google-event-recurrence";

const DAY_NAMES: Record<string, string> = Object.fromEntries(
  GOOGLE_EVENT_WEEKDAYS.map((weekday) => [weekday.value, weekday.label])
);
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const ORDINAL_DAY = /^(-?\d)([A-Z]{2})$/;
const ORDINAL_WORDS: Record<string, string> = {
  "-1": "last",
  "-2": "second-to-last",
  "1": "1st",
  "2": "2nd",
  "3": "3rd",
  "4": "4th",
  "5": "5th",
};
const BY_MONTH_PATTERN = /BYMONTH=([\d,]+)(?:;|$)/;
const POSITIVE_DAY = /^\d{1,2}$/;
const WEEKDAYS = "MO,TU,WE,TH,FR";
/** Day sets a BYSETPOS rule picks from, by their sorted BYDAY. */
const DAY_SET_WORDS: Record<string, string> = {
  [WEEKDAYS]: "weekday",
  "MO,TU,WE,TH,FR,SA,SU": "day",
  "SA,SU": "weekend day",
};
/** Rule parts that aren't BY... parts (`constraintKeys`). */
const PLAIN_PARTS = new Set(["FREQ", "INTERVAL", "UNTIL", "COUNT", "WKST"]);

const FREQUENCY_WORDS: Record<string, [string, string] | undefined> = {
  DAILY: ["daily", "days"],
  MONTHLY: ["monthly", "months"],
  WEEKLY: ["weekly", "weeks"],
  YEARLY: ["yearly", "years"],
};

/** The parts of a series' start the words fall back on. */
interface RecurrenceStart {
  day: number;
  /** 1 Monday to 7 Sunday. */
  dayOfWeek: number;
  month: number;
}

/** "2nd Tue" for BYDAY=2TU; null for a plain or unknown code. */
function ordinalDayLabel(code: string): string | null {
  const match = ORDINAL_DAY.exec(code);
  const ordinal = match ? ORDINAL_WORDS[match[1] ?? ""] : undefined;
  const day = match ? DAY_NAMES[match[2] ?? ""] : undefined;
  return ordinal && day ? `${ordinal} ${day}` : null;
}

/**
 * Which weekday of the month a rule's BYDAY (and BYSETPOS) means, in
 * words: "2nd Tue" for BYDAY=2TU, "last weekday" for
 * BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1, "2nd Mon" for BYDAY=MO;BYSETPOS=2.
 * Null when there's none, or it isn't one put in words here.
 */
function monthlyWeekdayLabel(
  rule: string | undefined,
  byDay: string[]
): string | null {
  const setPos = setPositionOf(rule);
  // Several positions ("BYSETPOS=1,3") aren't put in words.
  if (setPos === null) {
    return null;
  }
  if (setPos === undefined) {
    const labels = byDay.map(ordinalDayLabel);
    return labels.length > 0 && labels.every(Boolean)
      ? labels.join(", ")
      : null;
  }
  const ordinal = ORDINAL_WORDS[setPos];
  if (!(ordinal && byDay.every(isPlainWeekday))) {
    return null;
  }
  const sorted = weekOrdered(byDay);
  const days =
    DAY_SET_WORDS[sorted.join(",")] ??
    (sorted.length === 1 ? DAY_NAMES[sorted[0] ?? ""] : undefined);
  return days ? `${ordinal} ${days}` : null;
}

/**
 * Days of the month in words: "day 15", "days 1, 15", "the last day".
 * Null for other counts from the end (-2...) or a mix with them.
 */
function monthDaysLabel(monthDays: string[]): string | null {
  if (monthDays.join() === "-1") {
    return "the last day";
  }
  if (monthDays.length === 0 || !monthDays.every((d) => POSITIVE_DAY.test(d))) {
    return null;
  }
  return `${monthDays.length === 1 ? "day" : "days"} ${monthDays.join(", ")}`;
}

/** Which day of the period, in words, and the rule parts that says. */
interface DayWords {
  text: string | null;
  used: string[];
}

/** "on the 2nd Tue", "on the last day", or the start's "on day 7". */
function monthlyDay(
  rule: string | undefined,
  pattern: EventRecurrencePattern,
  start: RecurrenceStart | undefined
): DayWords {
  if (pattern.byDay.length > 0) {
    const label = monthlyWeekdayLabel(rule, pattern.byDay);
    return { text: label && `on the ${label}`, used: ["BYDAY", "BYSETPOS"] };
  }
  if (pattern.monthDays.length > 0) {
    const label = monthDaysLabel(pattern.monthDays);
    // BYSETPOS here isn't in the words, so it stays unused: "(custom)".
    return { text: label && `on ${label}`, used: ["BYMONTHDAY"] };
  }
  return { text: start ? `on day ${start.day}` : null, used: [] };
}

/** "on the 4th Thu of Nov", "on Nov 15", or the start's "on Nov 7". */
function yearlyDay(
  rule: string | undefined,
  pattern: EventRecurrencePattern,
  start: RecurrenceStart | undefined
): DayWords {
  const months = BY_MONTH_PATTERN.exec(rule ?? "")?.[1]?.split(",") ?? [];
  const named = pattern.byDay.length > 0 || pattern.monthDays.length > 0;
  if (months.length === 0) {
    // Days with no month ("4th Thu", "day 15") fall in every month or
    // count through the year: not put in words, so marked custom.
    const month = start && MONTH_NAMES[start.month - 1];
    return {
      text: !named && month ? `on ${month} ${start.day}` : null,
      used: [],
    };
  }
  const month = months.length === 1 ? MONTH_NAMES[Number(months[0]) - 1] : null;
  if (!month) {
    return { text: null, used: [] };
  }
  if (pattern.byDay.length > 0) {
    const label = monthlyWeekdayLabel(rule, pattern.byDay);
    return {
      text: label ? `on the ${label} of ${month}` : null,
      used: ["BYMONTH", "BYDAY", "BYSETPOS"],
    };
  }
  const [monthDay = ""] = pattern.monthDays;
  if (pattern.monthDays.length > 0) {
    return {
      text:
        pattern.monthDays.length === 1 && POSITIVE_DAY.test(monthDay)
          ? `on ${month} ${monthDay}`
          : null,
      used: ["BYMONTH", "BYMONTHDAY"],
    };
  }
  return {
    text: start ? `on ${month} ${start.day}` : `in ${month}`,
    used: ["BYMONTH"],
  };
}

/** The rule's BY... parts, by name. */
function constraintKeys(rule: string | undefined): string[] {
  return (rule ?? "")
    .replace("RRULE:", "")
    .split(";")
    .map((part) => part.split("=")[0] ?? "")
    .filter((key) => key && !PLAIN_PARTS.has(key));
}

/** The words for a rule's days, and whether they cover every BY... part. */
function dayWords(
  rule: string | undefined,
  pattern: EventRecurrencePattern,
  start: RecurrenceStart | undefined
): { complete: boolean; text: string | null } {
  const { byDay, freq } = pattern;
  let words: DayWords = { text: null, used: [] };
  if (freq === "WEEKLY") {
    const startDay = start ? weekdayCodeOf(start) : undefined;
    const codes = weekOrdered(
      byDay.length > 0 || !startDay ? byDay : [startDay]
    );
    const days =
      codes.join(",") === WEEKDAYS
        ? "weekdays"
        : codes
            .map((code) => DAY_NAMES[code])
            .filter(Boolean)
            .join(", ");
    const plain = byDay.every(isPlainWeekday);
    words = { text: days && plain ? `on ${days}` : null, used: ["BYDAY"] };
  } else if (freq === "MONTHLY") {
    words = monthlyDay(rule, pattern, start);
  } else if (freq === "YEARLY") {
    words = yearlyDay(rule, pattern, start);
  }
  const keys = constraintKeys(rule);
  const complete =
    keys.length === 0 ||
    (words.text !== null && keys.every((key) => words.used.includes(key)));
  return { complete, text: words.text };
}

function endWords(end: EventRecurrenceEnd, timeZone: string): string {
  if (end.type === "count") {
    return `, ${end.count} ${end.count === 1 ? "time" : "times"}`;
  }
  const day =
    end.type === "until" ? recurrenceEndDay(end.date, timeZone) : null;
  return day
    ? `, until ${MONTH_NAMES[day.month - 1]} ${day.day}, ${day.year}`
    : "";
}

/**
 * How a Google event repeats, in words ("Repeats weekly on Mon, Wed", or
 * with `timeZone` "Repeats weekly on Mon, Wed, until Feb 10, 2027").
 * `rules` is the series' RRULE list (the event's own, or its master's).
 * An instance whose rule isn't loaded still says it repeats. A rule whose
 * parts the words don't all cover, or a series with more than one rule,
 * ends in "(custom)", so what they leave out isn't hidden. Null for a
 * one-off event.
 */
export function describeEventRecurrence(params: {
  eventType?: string | null;
  recurringEventId?: string | null;
  rules: string[] | null | undefined;
  /**
   * The series' start (or the occurrence's): a rule that doesn't name its
   * day repeats on the start's, and says so ("Repeats weekly on Sat",
   * "Repeats monthly on day 7").
   */
  start?: RecurrenceStart;
  /**
   * The series' zone, where its end day is counted. Given, the words say
   * how the series ends too (", until Feb 10, 2027", ", 10 times"); left
   * out, they stop at how it repeats, for a short label.
   */
  timeZone?: string;
}): string | null {
  const rule = getPrimaryRecurrenceRule(params.rules ?? []) ?? undefined;
  const pattern = parseGoogleEventRecurrenceRule(rule);
  const words = FREQUENCY_WORDS[pattern.freq];
  if (!words) {
    if (params.eventType === "birthday") {
      return "Repeats yearly";
    }
    // A rule this app can't put in words (hourly, say) still repeats.
    if (rule) {
      return "Repeats (custom)";
    }
    return params.recurringEventId ? "Repeats" : null;
  }
  const base =
    pattern.interval > 1
      ? `Repeats every ${pattern.interval} ${words[1]}`
      : `Repeats ${words[0]}`;
  const { complete, text } = dayWords(rule, pattern, params.start);
  const repeats = text ? `${base} ${text}` : base;
  const said = params.timeZone
    ? `${repeats}${endWords(pattern.end, params.timeZone)}`
    : repeats;
  const customLines =
    (params.rules ?? []).some(
      (line) => line.startsWith("RDATE") || line.startsWith("EXRULE")
    ) ||
    (params.rules ?? []).filter((line) => line.startsWith("RRULE:")).length > 1;
  return complete && !customLines ? said : `${said} (custom)`;
}

/** One monthly "On" choice: its label and the BYDAY / BYMONTHDAY it sets. */
interface MonthlyDayOption {
  byDay: string[];
  label: string;
  monthDays: string[];
  selected: boolean;
}

const sameList = (a: string[], b: string[]) => a.join() === b.join();
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

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
  // BYSETPOS over days of the month ("the later of the 15th and 30th"),
  // or weekdays limited to some days of the month ("the 1st Mon, if on
  // the 1st to 3rd"), isn't put in words.
  let own: string | null = null;
  if (pattern.byDay.length > 0) {
    own =
      pattern.monthDays.length === 0
        ? monthlyWeekdayLabel(rule, pattern.byDay)
        : null;
  } else if (setPos === undefined) {
    own = monthDaysLabel(pattern.monthDays);
  }
  return [
    {
      byDay: pattern.byDay,
      label: own
        ? capitalize(pattern.byDay.length > 0 ? `the ${own}` : own)
        : "Custom days",
      monthDays: pattern.monthDays,
      selected: true,
    },
    ...options,
  ];
}
