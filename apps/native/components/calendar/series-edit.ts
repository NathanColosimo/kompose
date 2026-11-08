import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { Temporal } from "temporal-polyfill";

interface EventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The fields the editor sends, as it builds them from the form. */
export interface EditedFields {
  colorId?: string;
  conferenceData?: GoogleEvent["conferenceData"];
  description?: string;
  end: EventTime;
  location?: string;
  start: EventTime;
  summary: string;
}

type Occurrence = Pick<
  GoogleEvent,
  | "colorId"
  | "conferenceData"
  | "description"
  | "end"
  | "location"
  | "originalStartTime"
  | "start"
  | "summary"
>;

/** Whether two Google starts (or ends) are the same moment and form. */
function sameTime(
  a: { date?: string | null; dateTime?: string | null },
  b: { date?: string | null; dateTime?: string | null }
): boolean {
  if (a.date || b.date) {
    return a.date === b.date && !(a.dateTime || b.dateTime);
  }
  if (!(a.dateTime && b.dateTime)) {
    return false;
  }
  return (
    Temporal.Instant.compare(
      Temporal.Instant.from(a.dateTime),
      Temporal.Instant.from(b.dateTime)
    ) === 0
  );
}

/** How long an event lasts: days when all day, else exact time. */
function lengthOf(start: EventTime, end: EventTime): Temporal.Duration | null {
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

/** `start` moved on by `length`, in the same form. */
function plus(start: EventTime, length: Temporal.Duration): EventTime {
  if (start.date) {
    return { date: Temporal.PlainDate.from(start.date).add(length).toString() };
  }
  return {
    dateTime: Temporal.Instant.from(start.dateTime ?? "")
      .add(length)
      .toString(),
    timeZone: start.timeZone,
  };
}

/**
 * The saved event's series pattern: its own rules, or its master's. Not
 * the form's, which may add a repeat to a one-off event that isn't a
 * series yet. A repeat differing from this is what a save sends.
 */
export function savedSeriesRecurrence(
  event: Pick<GoogleEvent, "recurrence"> | undefined,
  masterRecurrence: string[] | undefined
): string[] {
  return event?.recurrence?.length
    ? event.recurrence
    : (masterRecurrence ?? []);
}

/** A text field as the editor seeded it from the occurrence. */
function seeded(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * An edit made through one occurrence, saved for its series (This and
 * following, or Entire series): only what the user changed, measured
 * against the occurrence the editor opened with. A field they left alone
 * is left out, so the series keeps its own (the server starts from the
 * series and lays the edit over it); a rescheduled occurrence's own title
 * or time doesn't spread to the series. Times left alone are the
 * occurrence's place in the series (its original start) with the series'
 * length; a changed end alone keeps that start and takes the new length.
 */
export function seriesEditFields(params: {
  edited: EditedFields;
  occurrence: Occurrence;
  /** The series' own start and end, once loaded: its length. */
  series?: Pick<GoogleEvent, "end" | "start"> | null;
}): Omit<EditedFields, "summary"> & { summary?: string } {
  const { edited, occurrence } = params;
  const text = (
    value: string | undefined,
    seed: string | null | undefined
  ): string | undefined => {
    const now = value?.trim() ?? "";
    // Cleared on purpose: an empty value clears the series' too.
    return now === seeded(seed) ? undefined : now;
  };
  const conferenceChanged =
    JSON.stringify(edited.conferenceData ?? null) !==
    JSON.stringify(occurrence.conferenceData ?? null);
  return {
    // A color taken off can't be sent yet (leaving it out keeps the
    // series'), so only a new color goes out.
    colorId:
      (edited.colorId ?? null) === (occurrence.colorId ?? null)
        ? undefined
        : edited.colorId,
    conferenceData: conferenceChanged ? edited.conferenceData : undefined,
    description: text(edited.description, occurrence.description),
    location: text(edited.location, occurrence.location),
    summary: text(edited.summary, occurrence.summary),
    ...seriesEditTimes({ edited, occurrence, series: params.series }),
  };
}

/**
 * The start a save for the series sends when the user left this
 * occurrence's start alone: its place in the series (its original start,
 * in the series' form), not where it was rescheduled to. Null when the
 * start is the user's own.
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
        dateTime: original.dateTime ?? undefined,
        timeZone: original.timeZone ?? edited.timeZone,
      };
}

/**
 * The start and end a series edit sends: the user's when they changed the
 * start. Otherwise the occurrence's place in the series, lasting as long
 * as the series (times left alone) or as the user's new end makes it.
 * That needs the series loaded, or the user's end in the series' form
 * (date or time); else the form's times go as they are.
 */
function seriesEditTimes(params: {
  edited: Pick<EditedFields, "end" | "start">;
  occurrence: Pick<GoogleEvent, "end" | "originalStartTime" | "start">;
  series?: Pick<GoogleEvent, "end" | "start"> | null;
}): { end: EventTime; start: EventTime } {
  const { edited, occurrence, series } = params;
  const start = keptSeriesStart(edited.start, occurrence);
  if (!start) {
    return { end: edited.end, start: edited.start };
  }
  const endKept = sameTime(edited.end, occurrence.end);
  // An all-day exception of a timed series (or the reverse) can't lend
  // its length to the series' start.
  const sameForm = Boolean(start.date) === Boolean(edited.start.date);
  let length: Temporal.Duration | null = null;
  if (endKept) {
    length = series ? lengthOf(series.start, series.end) : null;
  } else if (sameForm) {
    length = lengthOf(edited.start, edited.end);
  }
  return length
    ? { end: plus(start, length), start }
    : { end: edited.end, start: edited.start };
}

/** The form's start as Google takes it: a date, or an instant in its zone. */
export function editedStartOf(
  values: {
    allDay: boolean;
    startDate: Temporal.PlainDate;
    startTime: Temporal.PlainTime | null;
  },
  /** The zone the form shows (and picks) times in. */
  appTimeZone: string,
  /** The zone the event keeps (`eventTimeZone`). */
  eventZone: string
): EventTime {
  if (values.allDay || !values.startTime) {
    return { date: values.startDate.toString() };
  }
  return {
    dateTime: values.startDate
      .toZonedDateTime({ plainTime: values.startTime, timeZone: appTimeZone })
      .toInstant()
      .toString(),
    timeZone: eventZone,
  };
}

/** The day a Google start falls on in `timeZone`. */
export function dayOf(start: EventTime, timeZone: string): Temporal.PlainDate {
  if (start.date) {
    return Temporal.PlainDate.from(start.date);
  }
  return Temporal.Instant.from(start.dateTime ?? "")
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
}
