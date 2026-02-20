import {
  buildGoogleEventRecurrenceRule,
  type EventRecurrenceEnd,
  type EventRecurrenceFrequency,
  GOOGLE_EVENT_WEEKDAYS,
  parseGoogleEventRecurrenceRule,
  untilInputToRule,
  untilRuleToInput,
} from "@kompose/state/google-event-recurrence";
import { dateToDateString, pickerDateToTemporal } from "@/lib/temporal-utils";

export type Frequency = EventRecurrenceFrequency;
export type RecurrenceEnd = EventRecurrenceEnd;
export const WEEKDAYS = GOOGLE_EVENT_WEEKDAYS;

export { untilInputToRule, untilRuleToInput };

export function parseRecurrence(rule?: string): {
  freq: Frequency;
  byDay: string[];
  end: RecurrenceEnd;
} {
  return parseGoogleEventRecurrenceRule(rule);
}

export function buildRecurrenceRule(
  freq: Frequency,
  byDay: string[],
  end: RecurrenceEnd
): string | null {
  return buildGoogleEventRecurrenceRule(freq, byDay, end);
}

interface TemporalFormValues {
  allDay: boolean;
  endDate: Date | null;
  endTime: string;
  startDate: Date | null;
  startTime: string;
}

interface TemporalPayload {
  endPayload: { date?: string; dateTime?: string };
  isAllDay: boolean;
  occurrenceStart: Date;
  startDateTime: Date | null;
  startPayload: { date?: string; dateTime?: string };
}

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

  const startPayload = isAllDayEvent
    ? { date: dateToDateString(startDate) }
    : { dateTime: startDateTime?.toISOString() };

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
