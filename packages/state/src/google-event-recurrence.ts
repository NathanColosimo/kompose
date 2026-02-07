import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";

export type EventRecurrenceFrequency = "none" | "DAILY" | "WEEKLY" | "MONTHLY";

export type EventRecurrenceEnd =
  | { type: "none" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

export const GOOGLE_EVENT_WEEKDAYS: Array<{ value: string; label: string }> = [
  { value: "MO", label: "Mon" },
  { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" },
  { value: "TH", label: "Thu" },
  { value: "FR", label: "Fri" },
  { value: "SA", label: "Sat" },
  { value: "SU", label: "Sun" },
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

export function parseGoogleEventRecurrenceRule(rule?: string): {
  freq: EventRecurrenceFrequency;
  byDay: string[];
  end: EventRecurrenceEnd;
} {
  if (!rule?.startsWith("RRULE:")) {
    return { freq: "none", byDay: [], end: { type: "none" } };
  }

  const body = rule.replace("RRULE:", "");
  const parts = body.split(";");

  let freq: EventRecurrenceFrequency = "none";
  let byDay: string[] = [];
  let until: string | null = null;
  let count: number | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (
      key === "FREQ" &&
      (value === "DAILY" || value === "WEEKLY" || value === "MONTHLY")
    ) {
      freq = value;
    }
    if (key === "BYDAY" && value) {
      byDay = value.split(",");
    }
    if (key === "UNTIL" && value) {
      until = value;
    }
    if (key === "COUNT" && value) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        count = parsed;
      }
    }
  }

  if (until !== null) {
    return { freq, byDay, end: { type: "until", date: until } };
  }
  if (count !== null) {
    return { freq, byDay, end: { type: "count", count } };
  }

  return { freq, byDay, end: { type: "none" } };
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

export function getPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined
): string | undefined {
  return recurrence?.[0];
}

export function setPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined,
  rule: string | null
): string[] {
  const extras = recurrence?.slice(1) ?? [];
  if (!rule) {
    return extras;
  }
  return [rule, ...extras];
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
