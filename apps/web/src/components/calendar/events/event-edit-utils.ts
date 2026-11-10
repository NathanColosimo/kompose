import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import type { EventSaveChanges } from "@kompose/state/recurrence-scope-options";
import { seriesEditFields } from "@kompose/state/series-edit";
import { Temporal } from "temporal-polyfill";
import { dateToDateString, pickerDateToTemporal } from "@/lib/temporal-utils";

interface TemporalFormValues {
  allDay: boolean;
  endDate: Date | null;
  endTime: string;
  startDate: Date | null;
  startTime: string;
}

interface TemporalPayload {
  endPayload: { date?: string; dateTime?: string; timeZone?: string };
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
    startPayload,
  };
}

/** An occurrence gets the full edit; a series gets only the changed details. */
export function eventForScope({
  edited,
  occurrence,
  scope,
}: {
  edited: GoogleEvent;
  occurrence: GoogleEvent | undefined;
  scope: RecurrenceScope;
}): GoogleEvent {
  if (scope === "this" || !occurrence?.recurringEventId) {
    return edited;
  }
  return {
    ...seriesEditFields({
      edited: { ...edited, summary: edited.summary ?? "" },
      occurrence,
    }),
    id: edited.id,
    ...(edited.recurrence === undefined
      ? {}
      : { recurrence: edited.recurrence }),
  };
}

/** A day move would be lost when Entire series keeps the first event's date. */
export function saveFacts({
  edited,
  event,
  timeZone,
}: {
  edited: Pick<GoogleEvent, "start">;
  event: GoogleEvent;
  timeZone: string;
}): Pick<EventSaveChanges, "dateMoved"> {
  const day = (start: GoogleEvent["start"]) =>
    start.date ??
    (start.dateTime
      ? Temporal.Instant.from(start.dateTime)
          .toZonedDateTimeISO(timeZone)
          .toPlainDate()
          .toString()
      : undefined);
  return { dateMoved: day(edited.start) !== day(event.start) };
}
