import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  GOOGLE_EVENT_WEEKDAYS,
  seriesRecurrenceForSave,
} from "@kompose/state/google-event-recurrence";
import { Temporal } from "temporal-polyfill";
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

type EventTime = GoogleEvent["start"];

/**
 * The repeat a save for an occurrence's series sends: the user's own, or,
 * when the occurrence moved to another day, the series' rule following it
 * ("Weekly on Wed" moved to a Thursday repeats on Thursdays). The editor
 * shows this, so its Repeat says what Save will write.
 */
export function repeatForSeries(params: {
  /** The user changed the repeat with the Repeat control. */
  edited: boolean;
  editedStart: EventTime;
  master: Pick<GoogleEvent, "recurrence" | "start"> | undefined;
  occurrence: GoogleEvent | undefined;
  /** The form's repeat. */
  recurrence: string[];
  timeZone: string;
}): string[] {
  const { edited, occurrence, recurrence } = params;
  if (edited || !occurrence) {
    return recurrence;
  }
  return (
    seriesRecurrenceForSave({
      editedStart: params.editedStart,
      masterRecurrence: params.master?.recurrence,
      masterStart: params.master?.start,
      occurrence,
      recurrence: undefined,
      timeZone: params.timeZone,
    }) ?? recurrence
  );
}

/** The same moment (or date): offsets and formats aside. */
function sameTime(a: EventTime | undefined, b: EventTime | undefined) {
  if (a?.dateTime && b?.dateTime) {
    return Temporal.Instant.from(a.dateTime).equals(
      Temporal.Instant.from(b.dateTime)
    );
  }
  return Boolean(a?.date) && a?.date === b?.date;
}

/** How long an event lasts, in exact time or in days. */
function lengthOf(event: Pick<GoogleEvent, "end" | "start">) {
  const { end, start } = event;
  if (start.dateTime && end.dateTime) {
    return Temporal.Instant.from(start.dateTime).until(
      Temporal.Instant.from(end.dateTime)
    );
  }
  if (start.date && end.date) {
    return Temporal.PlainDate.from(start.date).until(
      Temporal.PlainDate.from(end.date)
    );
  }
  return null;
}

/** The occurrence's place in its series: its original start, the series' length. */
function seriesSlot(
  occurrence: GoogleEvent,
  master: Pick<GoogleEvent, "end" | "start">
): { end: EventTime; start: EventTime } | null {
  const start = occurrence.originalStartTime;
  const length = lengthOf(master);
  if (!(start && length)) {
    return null;
  }
  if (start.dateTime) {
    const end = Temporal.Instant.from(start.dateTime).add(length);
    return {
      end: { dateTime: end.toString(), timeZone: master.end.timeZone },
      start: { dateTime: start.dateTime, timeZone: master.start.timeZone },
    };
  }
  if (start.date) {
    return {
      end: { date: Temporal.PlainDate.from(start.date).add(length).toString() },
      start: { date: start.date },
    };
  }
  return null;
}

/**
 * What a save for an occurrence's series ("This and following", "Entire
 * series") sends: the edits, and the series' own value for every field the
 * user left alone. The form starts from the occurrence, so one rescheduled
 * or renamed on its own would otherwise spread its time and title to every
 * later meeting.
 */
export function seriesEventForSave({
  master,
  occurrence,
  sent,
}: {
  master: GoogleEvent;
  occurrence: GoogleEvent;
  /** The save built from the form. */
  sent: GoogleEvent;
}): GoogleEvent {
  const keep = <K extends "colorId" | "description" | "location" | "summary">(
    key: K
  ) =>
    (sent[key] ?? "") === (occurrence[key] ?? "") ? master[key] : sent[key];
  const timesKept =
    sameTime(sent.start, occurrence.start) &&
    sameTime(sent.end, occurrence.end);
  const slot = timesKept ? seriesSlot(occurrence, master) : null;
  const rescheduled =
    slot &&
    !(
      sameTime(slot.start, occurrence.start) &&
      sameTime(slot.end, occurrence.end)
    );
  return {
    ...sent,
    colorId: keep("colorId"),
    description: keep("description"),
    location: keep("location"),
    summary: keep("summary"),
    ...(rescheduled ? slot : {}),
  };
}
