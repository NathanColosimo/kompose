import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { changedFields, keepsTimes } from "@kompose/google-cal/series-edits";
import { dayOfStart } from "@kompose/google-cal/until";
import type { Temporal } from "temporal-polyfill";
import {
  occurrenceDayMoved,
  repeatChanged,
  repeatCountingDay,
  seriesRecurrenceForSave,
} from "./google-event-recurrence";
import type { EventTime, StartTime } from "./google-event-times";

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

/**
 * An edit made through one occurrence, saved for its series (This and
 * following, or Entire series): only the fields the user changed,
 * measured against the occurrence the editor opened with. A field left
 * alone is left out, so the series keeps its own (the server lays the edit
 * over the series, `{ ...master, ...event }`), and a rescheduled
 * occurrence's own title doesn't spread to the series. A cleared text
 * field or color is sent empty, which clears the series' too (a meeting
 * can't be removed in the editors). The times go as they are: when they
 * are the occurrence's own, the server keeps the series' slot, and a
 * moved occurrence keeps its move.
 */
export function seriesEditFields(params: {
  edited: EditedFields;
  occurrence: GoogleEvent;
}): Omit<EditedFields, "summary"> & { summary?: string } {
  const { edited, occurrence } = params;
  // As the server reads them (`changedFields`): an empty field is "", so
  // one the user cleared still differs from the occurrence's.
  const changes = changedFields(
    {
      colorId: edited.colorId ?? "",
      conferenceData: edited.conferenceData,
      description: edited.description?.trim() ?? "",
      location: edited.location?.trim() ?? "",
      summary: edited.summary.trim(),
    },
    occurrence
  );
  return { ...changes, end: edited.end, start: edited.start };
}

/**
 * The repeat an editor shows, and its days count from, for what a save
 * would send. An occurrence moved to another day in this edit takes the
 * series' rule along (`seriesRecurrenceForSave`: "weekly on Mon" becomes
 * "weekly on Tue"), so the repeat row and its day chips say so before the
 * save. `startDay` is where a save for the series starts: the occurrence's
 * place in the series (a rescheduled one's original day) while the edit
 * keeps its times, as the server reads it, else the edited start's day.
 * The repeat's implicit days count from there, unless the save keeps the
 * series' own rule and slot: then from the series' first day.
 */
export function seriesRepeatForEdit(params: {
  /** The edited start and end, as the save sends them. */
  edited: Pick<EditedFields, "end" | "start">;
  event:
    | Pick<
        GoogleEvent,
        | "end"
        | "originalStartTime"
        | "recurrence"
        | "recurringEventId"
        | "start"
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
  /** The day the repeat's implicit days count from. */
  countingDay: Temporal.PlainDate | null;
  /** The repeat to show. */
  recurrence: string[];
  /** The day a save for the series starts on. */
  startDay: Temporal.PlainDate | null;
} {
  const { edited, event, timeZone } = params;
  const editedStart = edited.start;
  const occurrence = event?.recurringEventId ? event : null;
  const changed = repeatChanged({
    edited: params.recurrenceEdited,
    recurrence: params.recurrence,
    source: event?.recurrence?.length
      ? event.recurrence
      : (params.seriesRecurrence ?? []),
  });
  const moved = Boolean(
    occurrence &&
      occurrenceDayMoved({
        editedEnd: edited.end,
        editedStart,
        occurrence,
        timeZone,
      })
  );
  const followed =
    occurrence && moved && !changed
      ? seriesRecurrenceForSave({
          editedEnd: edited.end,
          editedStart,
          masterRecurrence: params.seriesRecurrence,
          masterStart: params.seriesStart,
          occurrence,
          recurrence: undefined,
          timeZone,
        })
      : undefined;
  // The server keeps the series' slot for an edit that keeps both times;
  // otherwise a save for the series starts at the edited start.
  const timesKept = occurrence && keepsTimes(edited, occurrence, timeZone);
  const startDay = dayOfStart(
    (timesKept && occurrence.originalStartTime) || editedStart,
    timeZone
  );
  // The series' own rule and slot: its days count from its first day.
  // A new repeat, day or time starts it again at `startDay`.
  const countingDay =
    timesKept && !changed
      ? repeatCountingDay({
          event,
          formDay: startDay,
          seriesStart: params.seriesStart,
          timeZone,
        })
      : startDay;
  return {
    changed,
    countingDay,
    recurrence: followed ?? params.recurrence,
    startDay,
  };
}
