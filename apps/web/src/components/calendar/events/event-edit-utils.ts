import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import type { EventSaveChanges } from "@kompose/state/recurrence-scope-options";
import { seriesEditFields } from "@kompose/state/series-edit";
import { moveEventStart } from "@kompose/state/temporal-utils";
import { Temporal } from "temporal-polyfill";
import {
  dateToDateString,
  pickerDateToTemporal,
  temporalToPickerDate,
} from "@/lib/temporal-utils";

export interface TemporalFormValues {
  allDay: boolean;
  endDate: Date | null;
  /** Zoned moments retain which half of a repeated hour the form means. */
  endMoment?: string;
  endTime: string;
  startDate: Date | null;
  startMoment?: string;
  startTime: string;
}

/** The form's range as Temporal values, for moves and validation. */
function eventFormRange(values: TemporalFormValues, startDate: Date) {
  const time = (value: string) =>
    !values.allDay && value ? Temporal.PlainTime.from(value) : null;
  const start = pickerDateToTemporal(startDate);
  return {
    end: values.endMoment
      ? Temporal.ZonedDateTime.from(values.endMoment)
      : undefined,
    endDate: values.endDate ? pickerDateToTemporal(values.endDate) : start,
    endTime: time(values.endTime),
    start: values.startMoment
      ? Temporal.ZonedDateTime.from(values.startMoment)
      : undefined,
    startDate: start,
    startTime: time(values.startTime),
  };
}

/** Move the form's start while retaining the shared helper's duration. */
export function moveEventFormStart(
  values: TemporalFormValues,
  next: { date?: Temporal.PlainDate; time?: Temporal.PlainTime },
  timeZone: string
): TemporalFormValues {
  if (!values.startDate) {
    return values;
  }
  const moved = moveEventStart(
    eventFormRange(values, values.startDate),
    next,
    timeZone
  );
  return {
    ...values,
    startMoment: moved.start?.toString(),
    endMoment: moved.end?.toString(),
    startDate: temporalToPickerDate(moved.startDate),
    endDate: temporalToPickerDate(moved.endDate),
    startTime:
      moved.startTime?.toString({ smallestUnit: "minute" }) ?? values.startTime,
    endTime:
      moved.endTime?.toString({ smallestUnit: "minute" }) ?? values.endTime,
  };
}

interface TemporalPayload {
  endPayload: { date?: string; dateTime?: string; timeZone?: string };
  startPayload: { date?: string; dateTime?: string; timeZone?: string };
}

function buildDateTimeValue(
  date: Date | null,
  time: string,
  moment?: string
): Date | null {
  if (!(date && time)) {
    return null;
  }
  if (moment) {
    const zoned = Temporal.ZonedDateTime.from(moment);
    const clock = pickerDateToTemporal(date).toPlainDateTime(
      Temporal.PlainTime.from(time)
    );
    const resolved = zoned.toPlainDateTime().equals(clock)
      ? zoned
      : clock.toZonedDateTime(zoned.timeZoneId);
    return new Date(resolved.epochMilliseconds);
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
    values.startTime,
    values.startMoment
  );
  const endDateTime = buildDateTimeValue(
    resolvedTimes.end,
    values.endTime,
    values.endMoment
  );

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
