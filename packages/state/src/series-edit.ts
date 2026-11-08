import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { dayOfStart } from "@kompose/google-cal/until";
import { Temporal } from "temporal-polyfill";
import {
  occurrenceDayMoved,
  repeatChanged,
  repeatCountingDay,
  seriesRecurrenceForSave,
} from "./google-event-recurrence";
import {
  type EventTime,
  type StartTime,
  sameEventTime,
} from "./google-event-times";

/** The fields an editor sends for an event, as it builds them from its form. */
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

/**
 * An edit made through one occurrence, saved for its series (This and
 * following, or Entire series): only what the user changed, measured
 * against the occurrence the editor opened with. A field left alone is
 * left out, so the series keeps its own (the server lays the edit over
 * the series, `{ ...master, ...event }`), and a rescheduled occurrence's
 * own title or time doesn't spread to the series. A field cleared on
 * purpose is sent empty, which clears the series' too. Times: see
 * `seriesEditTimes`.
 */
export function seriesEditFields(params: {
  edited: EditedFields;
  occurrence: Occurrence;
  /** The series' own start and end, once loaded: its length. */
  series?: Pick<GoogleEvent, "end" | "start"> | null;
}): Omit<EditedFields, "summary"> & { summary?: string } {
  const { edited, occurrence } = params;
  const conferenceChanged =
    JSON.stringify(edited.conferenceData ?? null) !==
    JSON.stringify(occurrence.conferenceData ?? null);
  return {
    colorId:
      (edited.colorId ?? null) === (occurrence.colorId ?? null)
        ? undefined
        : edited.colorId,
    conferenceData: conferenceChanged ? edited.conferenceData : undefined,
    description: changedText(edited.description, occurrence.description),
    location: changedText(edited.location, occurrence.location),
    summary: changedText(edited.summary, occurrence.summary),
    ...seriesEditTimes({ edited, occurrence, series: params.series }),
  };
}

/** `now` when it differs from the text the editor opened with (trimmed). */
function changedText(
  now: string | undefined,
  opened: string | null | undefined
): string | undefined {
  const text = now?.trim() ?? "";
  return text === (opened?.trim() ?? "") ? undefined : text;
}

/**
 * The start and end a series edit sends: the user's when they changed the
 * start; otherwise the occurrence's place in the series (its original
 * start, not where it was rescheduled to), with the length they set if
 * they changed the end, else the series' own (or the occurrence's, before
 * the series loads).
 */
function seriesEditTimes(params: {
  edited: Pick<EditedFields, "end" | "start">;
  occurrence: Pick<GoogleEvent, "end" | "originalStartTime" | "start">;
  series?: Pick<GoogleEvent, "end" | "start"> | null;
}): { end: EventTime; start: EventTime } {
  const { edited, occurrence, series } = params;
  const start = keptSeriesStart(edited.start, occurrence);
  const length = sameEventTime(edited.end, occurrence.end)
    ? ((series && lengthOf(series.start, series.end)) ??
      lengthOf(occurrence.start, occurrence.end))
    : lengthOf(edited.start, edited.end);
  if (!(start && length)) {
    return { end: edited.end, start: edited.start };
  }
  return { end: plus(start, length), start };
}

/**
 * The start a save for the series sends when the user left this
 * occurrence's start alone: its place in the series (its original start).
 * Null when the start is the user's own.
 */
function keptSeriesStart(
  edited: EventTime,
  occurrence: Pick<GoogleEvent, "originalStartTime" | "start">
): EventTime | null {
  const original = occurrence.originalStartTime;
  if (!(original && sameEventTime(edited, occurrence.start))) {
    return null;
  }
  return original.date
    ? { date: original.date }
    : { dateTime: original.dateTime, timeZone: edited.timeZone };
}

/** How long an event lasts: days when all day, else exact time. */
function lengthOf(start: EventTime, end: EventTime): Temporal.Duration | null {
  try {
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
  } catch {
    // An unreadable time has no length: the edit's own times go.
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
 * The repeat an editor shows, and its days count from, for what a save
 * would send. An occurrence moved to another day in this edit takes the
 * series' rule along (`seriesRecurrenceForSave`: "weekly on Mon" becomes
 * "weekly on Tue"), so the repeat row and its day chips say so before the
 * save. `startDay` is where a save for the series starts: the new day, or,
 * left alone, the occurrence's place in the series (a rescheduled one's
 * original day), as `seriesEditFields` sends it.
 */
export function seriesRepeatForEdit(params: {
  /** The edited start, as the save sends it. */
  editedStart: EventTime;
  event:
    | Pick<
        GoogleEvent,
        "originalStartTime" | "recurrence" | "recurringEventId" | "start"
      >
    | null
    | undefined;
  /** The form's repeat. */
  recurrence: string[];
  /** The user touched the repeat in this editor. */
  recurrenceEdited: boolean;
  /** The series' recurrence (its master's), once loaded. */
  seriesRecurrence: string[] | undefined;
  /** The series' own start (its master's), once loaded. */
  seriesStart: StartTime | null | undefined;
  /** The series' zone (`eventTimeZone`), where its days count. */
  timeZone: string;
}): {
  /** The repeat differs from the series' (what a save would send). */
  changed: boolean;
  /** The day the repeat's implicit days count from (`repeatCountingDay`). */
  countingDay: Temporal.PlainDate | null;
  /** The repeat to show. */
  recurrence: string[];
  /** The day a save for the series starts on. */
  startDay: Temporal.PlainDate | null;
} {
  const { editedStart, event, timeZone } = params;
  const occurrence = event?.recurringEventId ? event : null;
  const changed = repeatChanged({
    edited: params.recurrenceEdited,
    recurrence: params.recurrence,
    source: event?.recurrence?.length
      ? event.recurrence
      : (params.seriesRecurrence ?? []),
  });
  const moved = Boolean(
    occurrence && occurrenceDayMoved({ editedStart, occurrence, timeZone })
  );
  const followed =
    occurrence && moved && !changed
      ? seriesRecurrenceForSave({
          editedStart,
          masterRecurrence: params.seriesRecurrence,
          masterStart: params.seriesStart,
          occurrence,
          recurrence: undefined,
          timeZone,
        })
      : undefined;
  const kept = occurrence ? keptSeriesStart(editedStart, occurrence) : null;
  return {
    changed,
    countingDay: repeatCountingDay({
      changed,
      event,
      formDay: dayOfStart(editedStart, timeZone),
      seriesStart: params.seriesStart,
      timeZone,
    }),
    recurrence: followed ?? params.recurrence,
    startDay: dayOfStart(kept ?? editedStart, timeZone),
  };
}
