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

export function buildGoogleEventRecurrenceRule(
  freq: EventRecurrenceFrequency,
  byDay: string[],
  end: EventRecurrenceEnd
): string | null {
  if (freq === "none") {
    return null;
  }

  const parts: string[] = [`FREQ=${freq}`];
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
  return freq === "WEEKLY" && days ? `${base} on ${days}` : base;
}
