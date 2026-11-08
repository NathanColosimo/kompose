import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";

export type EventRecurrenceFrequency =
  | "none"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "YEARLY";

export type EventRecurrenceEnd =
  | { type: "none" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

export const GOOGLE_EVENT_WEEKDAYS: Array<{ value: string; label: string }> = [
  { label: "Mon", value: "MO" },
  { label: "Tue", value: "TU" },
  { label: "Wed", value: "WE" },
  { label: "Thu", value: "TH" },
  { label: "Fri", value: "FR" },
  { label: "Sat", value: "SA" },
  { label: "Sun", value: "SU" },
];

const UNTIL_RULE_REGEX_DATEONLY = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_RULE_REGEX_FULL =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function untilRuleToInput(raw?: string | null): string {
  if (!raw) {
    return "";
  }

  const cleaned = raw.replace(/[-:]/g, "");
  const dateOnlyMatch = cleaned.match(UNTIL_RULE_REGEX_DATEONLY);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return `${y}-${m}-${d}T00:00`;
  }

  const fullMatch = cleaned.match(UNTIL_RULE_REGEX_FULL);
  if (!fullMatch) {
    return "";
  }

  const [, y, m, d, hh, mm, ss, offset] = fullMatch;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${offset ?? "Z"}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function untilInputToRule(input?: string | null): string | null {
  if (!input) {
    return null;
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function untilRuleToDate(raw?: string | null): Date | null {
  const input = untilRuleToInput(raw);
  if (!input) {
    return null;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateToUntilRule(date: Date): string | null {
  const input = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return untilInputToRule(input);
}

const VALID_FREQUENCIES = new Set<EventRecurrenceFrequency>([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
]);

function resolveEnd(
  until: string | null,
  count: number | null
): EventRecurrenceEnd {
  if (until !== null) {
    return { date: until, type: "until" };
  }
  if (count !== null) {
    return { count, type: "count" };
  }
  return { type: "none" };
}

export function parseGoogleEventRecurrenceRule(rule?: string): {
  freq: EventRecurrenceFrequency;
  byDay: string[];
  end: EventRecurrenceEnd;
} {
  if (!rule?.startsWith("RRULE:")) {
    return { byDay: [], end: { type: "none" }, freq: "none" };
  }

  const body = rule.replace("RRULE:", "");
  const parts = body.split(";");

  let freq: EventRecurrenceFrequency = "none";
  let byDay: string[] = [];
  let until: string | null = null;
  let count: number | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (!value) {
      continue;
    }

    switch (key) {
      case "FREQ":
        if (VALID_FREQUENCIES.has(value as EventRecurrenceFrequency)) {
          freq = value as EventRecurrenceFrequency;
        }
        break;
      case "BYDAY":
        byDay = value.split(",");
        break;
      case "UNTIL":
        until = value;
        break;
      case "COUNT": {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          count = parsed;
        }
        break;
      }
      default:
        break;
    }
  }

  return { byDay, end: resolveEnd(until, count), freq };
}

/** The rule parts the repeat editors set; the rest of a rule is kept. */
const EDITED_PARTS = new Set(["FREQ", "BYDAY", "UNTIL", "COUNT"]);
/**
 * Parts tied to a frequency, dropped when the frequency changes: picking
 * Monthly on an "every 2 weeks" series means every month, not every 2.
 */
const FREQUENCY_PARTS = new Set([
  "INTERVAL",
  "BYMONTHDAY",
  "BYMONTH",
  "BYSETPOS",
  "BYYEARDAY",
  "BYWEEKNO",
]);

/**
 * The parts of `baseRule` an edit keeps: everything the editors don't set
 * (INTERVAL, WKST...), so changing a biweekly series' end keeps it
 * biweekly; parts tied to the frequency go when it changes.
 */
function keptRuleParts(
  baseRule: string | undefined,
  freq: EventRecurrenceFrequency
): string[] {
  if (!baseRule?.startsWith("RRULE:")) {
    return [];
  }
  const parts = baseRule.replace("RRULE:", "").split(";");
  const baseFreq = parts
    .find((part) => part.startsWith("FREQ="))
    ?.slice("FREQ=".length);
  return parts.filter((part) => {
    const key = part.split("=")[0] ?? "";
    if (!part || EDITED_PARTS.has(key)) {
      return false;
    }
    return baseFreq === freq || !FREQUENCY_PARTS.has(key);
  });
}

const PLAIN_WEEKDAY = /^[A-Z]{2}$/;

/**
 * The BYDAY a repeat keeps when its frequency is picked: all of it for the
 * same frequency (re-picking Monthly keeps "2nd Tuesday"); the plain
 * weekdays when moving to Weekly ("2TU" isn't valid there, and none left
 * means the start's weekday); nothing for any other frequency.
 */
export function byDayForFrequency(
  byDay: string[],
  from: EventRecurrenceFrequency,
  to: EventRecurrenceFrequency
): string[] {
  if (from === to) {
    return byDay;
  }
  return to === "WEEKLY" ? byDay.filter((day) => PLAIN_WEEKDAY.test(day)) : [];
}

export function buildGoogleEventRecurrenceRule(
  freq: EventRecurrenceFrequency,
  byDay: string[],
  end: EventRecurrenceEnd,
  /** The rule being edited, whose other parts are kept. */
  baseRule?: string
): string | null {
  if (freq === "none") {
    return null;
  }

  const parts: string[] = [`FREQ=${freq}`, ...keptRuleParts(baseRule, freq)];
  if (byDay.length > 0) {
    parts.push(`BYDAY=${byDay.join(",")}`);
  }

  if (end.type === "until") {
    parts.push(`UNTIL=${end.date}`);
  } else if (end.type === "count") {
    parts.push(`COUNT=${end.count}`);
  }

  return `RRULE:${parts.join(";")}`;
}

const isRule = (line: string) => line.startsWith("RRULE:");

/** The series' RRULE line; Google may list EXDATE/RDATE lines with it. */
export function getPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined
): string | undefined {
  return recurrence?.find(isRule);
}

/**
 * Replace the RRULE, keeping the series' other lines (deleted occurrences
 * stay deleted). Without a rule nothing repeats, so the whole list clears:
 * EXDATE lines alone aren't a series.
 */
export function setPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined,
  rule: string | null
): string[] {
  if (!rule) {
    return [];
  }
  return [rule, ...(recurrence ?? []).filter((line) => !isRule(line))];
}

export function isRecurringGoogleEvent(params: {
  event?: Pick<GoogleEvent, "recurringEventId" | "recurrence"> | null;
  masterRecurrence?: string[] | null;
}): boolean {
  return Boolean(
    params.event?.recurringEventId ||
      params.event?.recurrence?.length ||
      params.masterRecurrence?.length
  );
}

export function getDefaultRecurrenceScopeForEvent(params: {
  event?: Pick<GoogleEvent, "recurringEventId" | "recurrence"> | null;
  masterRecurrence?: string[] | null;
}): RecurrenceScope {
  if (params.event?.recurringEventId) {
    return "this";
  }
  if (params.event?.recurrence?.length || params.masterRecurrence?.length) {
    return "all";
  }
  return "this";
}

const DAY_NAMES: Record<string, string> = {
  FR: "Fri",
  MO: "Mon",
  SA: "Sat",
  SU: "Sun",
  TH: "Thu",
  TU: "Tue",
  WE: "Wed",
};

const INTERVAL_PATTERN = /INTERVAL=(\d+)/;
const BY_MONTH_PATTERN = /BYMONTH=(\d{1,2})(?:;|$)/;
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

/** "on the 4th Thu of Nov" for a yearly rule with BYMONTH=11;BYDAY=4TH. */
function ordinalWhen(
  rule: string | undefined,
  freq: EventRecurrenceFrequency,
  byDay: string[]
): string | null {
  const ordinal = ordinalDays(byDay);
  const month = MONTH_NAMES[Number(BY_MONTH_PATTERN.exec(rule ?? "")?.[1]) - 1];
  return ordinal && month && freq === "YEARLY"
    ? `${ordinal} of ${month}`
    : ordinal;
}

/** "on the 2nd Tue" for a monthly or yearly rule's BYDAY=2TU. */
function ordinalDays(byDay: string[]): string | null {
  const words = byDay.map((code) => {
    const match = ORDINAL_DAY.exec(code);
    const ordinal = match ? ORDINAL_WORDS[match[1] ?? ""] : undefined;
    const day = match ? DAY_NAMES[match[2] ?? ""] : undefined;
    return ordinal && day ? `${ordinal} ${day}` : null;
  });
  return words.length > 0 && words.every(Boolean)
    ? `on the ${words.join(", ")}`
    : null;
}

/** RRULE weekday codes by Temporal dayOfWeek (1 Monday to 7 Sunday). */
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

const FREQUENCY_WORDS: Record<string, [string, string] | undefined> = {
  DAILY: ["daily", "days"],
  MONTHLY: ["monthly", "months"],
  WEEKLY: ["weekly", "weeks"],
  YEARLY: ["yearly", "years"],
};

/**
 * How a Google event repeats, for a read-only view ("Repeats weekly on Mon,
 * Wed"). `rules` is the series' RRULE list (the event's own, or its
 * master's). An instance whose rule isn't loaded still says it repeats.
 * Null for a one-off event.
 */
export function describeEventRecurrence(params: {
  eventType?: string | null;
  recurringEventId?: string | null;
  rules: string[] | null | undefined;
  /**
   * The start's weekday (1 Monday to 7 Sunday): a weekly rule with no days
   * repeats on it, and says so ("Repeats weekly on Sat").
   */
  startWeekday?: number;
}): string | null {
  const rule = getPrimaryRecurrenceRule(params.rules ?? []) ?? undefined;
  const { byDay, freq } = parseGoogleEventRecurrenceRule(rule);
  const words = FREQUENCY_WORDS[freq];
  if (!words) {
    if (params.eventType === "birthday") {
      return "Repeats yearly";
    }
    // A rule this app can't put in words (hourly, say) still repeats.
    return params.recurringEventId || rule ? "Repeats" : null;
  }
  const interval = Number.parseInt(
    INTERVAL_PATTERN.exec(rule ?? "")?.[1] ?? "1",
    10
  );
  const base =
    interval > 1
      ? `Repeats every ${interval} ${words[1]}`
      : `Repeats ${words[0]}`;
  const startDay = params.startWeekday
    ? WEEKDAY_CODES[params.startWeekday - 1]
    : undefined;
  const shownDays = byDay.length > 0 || !startDay ? byDay : [startDay];
  const days = shownDays
    .map((code) => DAY_NAMES[code.slice(-2)])
    .filter(Boolean)
    .join(", ");
  if (freq === "WEEKLY") {
    return days ? `${base} on ${days}` : base;
  }
  const when = ordinalWhen(rule, freq, byDay);
  return when ? `${base} ${when}` : base;
}
