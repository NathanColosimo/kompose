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
  /** Where the user put the occurrence. */
  editedStart: EventTime;
  master: Pick<GoogleEvent, "recurrence" | "start"> | undefined;
  occurrence: GoogleEvent | undefined;
  /** The form's repeat. */
  recurrence: string[];
  timeZone: string;
}): { followsMove: boolean; recurrence: string[] } {
  const { edited, occurrence, recurrence } = params;
  const followed =
    edited || !occurrence
      ? undefined
      : seriesRecurrenceForSave({
          editedStart: params.editedStart,
          masterRecurrence: params.master?.recurrence,
          masterStart: params.master?.start,
          occurrence,
          recurrence: undefined,
          timeZone: params.timeZone,
        });
  return followed
    ? { followsMove: true, recurrence: followed }
    : { followsMove: false, recurrence };
}

// The same checks as `sameTime`/`lengthMs` in packages/google-cal's
// series-times.ts and iOS's series-edit.ts; #127 moves them into
// packages/state as one shared version.

/** The same moment (or date): offsets and formats aside. */
function sameTime(a: EventTime, b: EventTime): boolean {
  if (a.date || b.date) {
    return a.date === b.date && !(a.dateTime || b.dateTime);
  }
  return Boolean(
    a.dateTime &&
      b.dateTime &&
      Temporal.Instant.from(a.dateTime).equals(
        Temporal.Instant.from(b.dateTime)
      )
  );
}

/** How long an event lasts: days when all day, else exact time. */
function lengthOf(start: EventTime, end: EventTime) {
  if (start.date && end.date) {
    return Temporal.PlainDate.from(start.date).until(
      Temporal.PlainDate.from(end.date)
    );
  }
  if (start.dateTime && end.dateTime) {
    return Temporal.Instant.from(start.dateTime).until(
      Temporal.Instant.from(end.dateTime)
    );
  }
  return null;
}

/**
 * The start a save for the series sends when the user left this
 * occurrence's start alone: its place in the series (its original start),
 * not where it was rescheduled to. Null when the start is the user's own.
 */
export function keptSeriesStart(
  edited: EventTime,
  occurrence: Pick<GoogleEvent, "originalStartTime" | "start">
): EventTime | null {
  const original = occurrence.originalStartTime;
  if (!(original && sameTime(edited, occurrence.start))) {
    return null;
  }
  return original.date
    ? { date: original.date }
    : {
        dateTime: original.dateTime,
        timeZone: edited.timeZone ?? original.timeZone,
      };
}

/** The day a Google start falls on in `timeZone`. */
export function startDay(start: EventTime, timeZone: string) {
  return start.date
    ? Temporal.PlainDate.from(start.date)
    : Temporal.Instant.from(start.dateTime ?? "")
        .toZonedDateTimeISO(timeZone)
        .toPlainDate();
}

/**
 * The start and end a series edit sends: the user's when they changed the
 * start; otherwise the occurrence's place in the series, with the length
 * they set if they changed the end, else the series'. A length counts only
 * in the kept start's form (days, or exact time): an occurrence made all
 * day, or timed, on its own can't lend the series its length. With no
 * length in that form, the edited times go as they are.
 */
function seriesEditTimes(
  edited: GoogleEvent,
  occurrence: GoogleEvent,
  series: Pick<GoogleEvent, "end" | "start"> | undefined
): Pick<GoogleEvent, "end" | "start"> {
  const start = keptSeriesStart(edited.start, occurrence);
  if (!start) {
    return { end: edited.end, start: edited.start };
  }
  const allDay = Boolean(start.date);
  const lengthInForm = (from: EventTime, to: EventTime) =>
    Boolean(from.date) === allDay && Boolean(to.date) === allDay
      ? lengthOf(from, to)
      : null;
  const length =
    (sameTime(edited.end, occurrence.end)
      ? null
      : lengthInForm(edited.start, edited.end)) ??
    (series ? lengthInForm(series.start, series.end) : null) ??
    lengthInForm(occurrence.start, occurrence.end);
  if (!length) {
    return { end: edited.end, start: edited.start };
  }
  const end = start.date
    ? { date: Temporal.PlainDate.from(start.date).add(length).toString() }
    : {
        dateTime: Temporal.Instant.from(start.dateTime ?? "")
          .add(length)
          .toString(),
        timeZone: start.timeZone,
      };
  return { end, start };
}

/** The trimmed value when the user changed the field, else null. */
function changedText(
  value: string | undefined,
  seed: string | undefined
): string | null {
  const now = value?.trim() ?? "";
  // Cleared on purpose: an empty value clears the series' too.
  return now === (seed?.trim() ?? "") ? null : now;
}

/**
 * An edit made through one occurrence, saved for its series ("This and
 * following", "Entire series"): its id, its repeat, its times, and only
 * the fields the user changed, measured against the occurrence the edit
 * started from. Every other field (guests, reminders, a meeting, a title
 * left alone) is left out, and the server fills it from the series, so a
 * rescheduled or renamed occurrence's own values don't spread to it.
 * Mirrors iOS's `seriesEditFields`; both move to packages/state with #127.
 */
export function seriesEdit({
  edited,
  occurrence,
  series,
}: {
  /** The save built from the form or the drop. */
  edited: GoogleEvent;
  occurrence: GoogleEvent;
  /** The series' own start and end, once loaded: its length. */
  series?: Pick<GoogleEvent, "end" | "start">;
}): GoogleEvent {
  const summary = changedText(edited.summary, occurrence.summary);
  const description = changedText(edited.description, occurrence.description);
  const location = changedText(edited.location, occurrence.location);
  const meetingAdded =
    JSON.stringify(edited.conferenceData ?? null) !==
    JSON.stringify(occurrence.conferenceData ?? null);
  return {
    id: edited.id,
    ...seriesEditTimes(edited, occurrence, series),
    ...(edited.recurrence ? { recurrence: edited.recurrence } : {}),
    ...(summary === null ? {} : { summary }),
    ...(description === null ? {} : { description }),
    ...(location === null ? {} : { location }),
    ...((edited.colorId ?? null) === (occurrence.colorId ?? null)
      ? {}
      : { colorId: edited.colorId }),
    ...(meetingAdded ? { conferenceData: edited.conferenceData } : {}),
  };
}
