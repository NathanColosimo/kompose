import { dateToDateString, pickerDateToTemporal } from "@/lib/temporal-utils";

export type Frequency = "none" | "DAILY" | "WEEKLY" | "MONTHLY";

export const WEEKDAYS: Array<{ value: string; label: string }> = [
  { value: "MO", label: "Mon" },
  { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" },
  { value: "TH", label: "Thu" },
  { value: "FR", label: "Fri" },
  { value: "SA", label: "Sat" },
  { value: "SU", label: "Sun" },
];

export type RecurrenceEnd =
  | { type: "none" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

const UNTIL_RULE_REGEX_DATEONLY = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_RULE_REGEX_FULL =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;

/**
 * Convert an RRULE UNTIL value (e.g. `20251212T010203Z`) to a `datetime-local` input.
 */
export function untilRuleToInput(raw?: string | null): string {
  if (!raw) {
    return "";
  }
  // Support date-only (YYYYMMDD) or date-time with optional offset.
  const cleaned = raw.replace(/[-:]/g, "");
  // Date only
  const dateOnlyMatch = cleaned.match(UNTIL_RULE_REGEX_DATEONLY);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return `${y}-${m}-${d}T00:00`;
  }

  // Date + time with optional Z/offset
  const fullMatch = cleaned.match(UNTIL_RULE_REGEX_FULL);
  if (!fullMatch) {
    return "";
  }
  const [, y2, m2, d2, hh, mm, ss, offset] = fullMatch;
  const iso = `${y2}-${m2}-${d2}T${hh}:${mm}:${ss}${offset ?? "Z"}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/**
 * Convert a `datetime-local` input value to an RRULE UNTIL value in UTC.
 */
export function untilInputToRule(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  // input: local datetime yyyy-MM-ddTHH:mm
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = dt.getUTCFullYear();
  const m = pad(dt.getUTCMonth() + 1);
  const d = pad(dt.getUTCDate());
  const hh = pad(dt.getUTCHours());
  const mm = pad(dt.getUTCMinutes());
  const ss = pad(dt.getUTCSeconds());
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

// biome-ignore lint: RRULE parsing combines frequency, days, and end options.
export function parseRecurrence(rule?: string): {
  freq: Frequency;
  byDay: string[];
  end: RecurrenceEnd;
} {
  if (!rule?.startsWith("RRULE:")) {
    return { freq: "none", byDay: [], end: { type: "none" } };
  }
  const body = rule.replace("RRULE:", "");
  const parts = body.split(";");
  let freq: Frequency = "none";
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
  let end: RecurrenceEnd = { type: "none" };
  if (until !== null) {
    end = { type: "until", date: until };
  } else if (count !== null) {
    end = { type: "count", count };
  }
  return { freq, byDay, end };
}

export function buildRecurrenceRule(
  freq: Frequency,
  byDay: string[],
  end: RecurrenceEnd
): string | null {
  if (freq === "none") {
    return null;
  }
  const parts: string[] = [`FREQ=${freq}`];
  if (freq === "WEEKLY" && byDay.length > 0) {
    parts.push(`BYDAY=${byDay.join(",")}`);
  }
  if (end.type === "until") {
    parts.push(`UNTIL=${end.date}`);
  } else if (end.type === "count") {
    parts.push(`COUNT=${end.count}`);
  }
  return `RRULE:${parts.join(";")}`;
}

type TemporalFormValues = {
  allDay: boolean;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string;
  endTime: string;
};

type TemporalPayload = {
  startPayload: { date?: string; dateTime?: string };
  endPayload: { date?: string; dateTime?: string };
  startDateTime: Date | null;
  isAllDay: boolean;
  occurrenceStart: Date;
};

/** Combine a Date and time string (HH:mm) into a single Date */
function buildDateTimeValue(date: Date | null, time: string): Date | null {
  if (!(date && time)) {
    return null;
  }
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function buildTemporalPayload(
  values: TemporalFormValues,
  clamp: (
    start: Date | null,
    end: Date | null
  ) => {
    start: Date | null;
    end: Date | null;
  }
): TemporalPayload | null {
  const isAllDayEvent = values.allDay;
  const startDate = values.startDate;
  const endDate = values.endDate ?? values.startDate;
  if (!startDate) {
    return null;
  }

  const resolvedTimes = clamp(startDate, endDate);

  const startDateTime = buildDateTimeValue(
    resolvedTimes.start,
    values.startTime
  );
  const endDateTime = buildDateTimeValue(resolvedTimes.end, values.endTime);

  // Use Temporal for date formatting to avoid timezone issues
  const startPayload = isAllDayEvent
    ? { date: dateToDateString(startDate) }
    : { dateTime: startDateTime?.toISOString() };

  // For all-day events, Google Calendar uses exclusive end date (next day)
  const endPayload = isAllDayEvent
    ? {
        date: resolvedTimes.end
          ? pickerDateToTemporal(resolvedTimes.end).add({ days: 1 }).toString()
          : undefined,
      }
    : { dateTime: endDateTime?.toISOString() };

  return {
    startPayload,
    endPayload,
    startDateTime,
    isAllDay: isAllDayEvent,
    occurrenceStart: startDateTime ?? startDate,
  };
}
