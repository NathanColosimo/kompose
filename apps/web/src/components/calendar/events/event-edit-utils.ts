import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { dayOfStart } from "@kompose/google-cal/until";
import { GOOGLE_EVENT_WEEKDAYS } from "@kompose/state/google-event-recurrence";
import { seriesEditFields } from "@kompose/state/series-edit";
import { ORPCError } from "@orpc/client";
import type { Temporal } from "temporal-polyfill";
import { dateToDateString, pickerDateToTemporal } from "@/lib/temporal-utils";

export const WEEKDAYS = GOOGLE_EVENT_WEEKDAYS;

interface TemporalFormValues {
  allDay: boolean;
  endDate: Date | null;
  endTime: string;
  startDate: Date | null;
  startTime: string;
}

interface TemporalPayload {
  endPayload: { date?: string; dateTime?: string; timeZone?: string };
  isAllDay: boolean;
  occurrenceStart: Date;
  startDateTime: Date | null;
  startPayload: { date?: string; dateTime?: string; timeZone?: string };
}

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
  },
  options?: {
    timeZone?: string;
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
    : {
        dateTime: startDateTime?.toISOString(),
        ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
      };

  const endPayload = isAllDayEvent
    ? {
        date: resolvedTimes.end
          ? pickerDateToTemporal(resolvedTimes.end).add({ days: 1 }).toString()
          : undefined,
      }
    : {
        dateTime: endDateTime?.toISOString(),
        ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
      };

  return {
    endPayload,
    isAllDay: isAllDayEvent,
    occurrenceStart: startDateTime ?? startDate,
    startDateTime,
    startPayload,
  };
}

/**
 * An edit made through one occurrence, as a save for its series ("This and
 * following", "Entire series") sends it: the event's id, its repeat when
 * the save sends one, and `seriesEditFields` (its times as they are, and
 * only the fields the user changed). The editor's payload starts from the
 * whole occurrence; everything else (guests, reminders, a title left
 * alone) is left out, and the server fills it from the series.
 */
export function seriesSave(
  edited: GoogleEvent,
  occurrence: GoogleEvent
): GoogleEvent {
  return {
    // Fields left as they were come back undefined, which the request
    // leaves out, so the series keeps its own.
    ...seriesEditFields({
      edited: { ...edited, summary: edited.summary ?? "" },
      occurrence,
    }),
    id: edited.id,
    ...(edited.recurrence ? { recurrence: edited.recurrence } : {}),
  };
}

/**
 * The server's refusal of a series write, from a failed save: a
 * BAD_REQUEST whose data says why (packages/google-cal's SeriesRefusal,
 * worded in its message). Retrying won't help, so the editor shows it.
 */
export function seriesRefusal(
  error: unknown
): { message: string; originalStarts: unknown; reason: unknown } | null {
  if (!(error instanceof ORPCError && error.code === "BAD_REQUEST")) {
    return null;
  }
  const data: unknown = error.data;
  if (!(typeof data === "object" && data !== null && "reason" in data)) {
    return null;
  }
  return {
    message: error.message,
    originalStarts: "originalStarts" in data ? data.originalStarts : undefined,
    reason: data.reason,
  };
}

/**
 * The day of the first moved (rescheduled) meeting a series save would
 * have undone, when the server refused it for that
 * (`dropsChangedOccurrences`, with the meetings' original starts as Google
 * writes them), in the series' zone; null for any other failure.
 */
export function refusedDropDay(
  error: unknown,
  timeZone: string
): Temporal.PlainDate | null {
  const refusal = seriesRefusal(error);
  if (
    !(
      refusal?.reason === "dropsChangedOccurrences" &&
      Array.isArray(refusal.originalStarts)
    )
  ) {
    return null;
  }
  const [first] = refusal.originalStarts;
  if (typeof first !== "string") {
    return null;
  }
  return dayOfStart(
    first.includes("T") ? { dateTime: first } : { date: first },
    timeZone
  );
}
