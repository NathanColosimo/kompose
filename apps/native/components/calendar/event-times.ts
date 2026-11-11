import { Temporal } from "temporal-polyfill";
import type { EventDraft } from "@/components/calendar/calendar-editor-types";

/** A timed start or end: an instant, in the zone the event keeps. */
interface TimedTime {
  dateTime: string;
  timeZone: string;
}

/**
 * An all-day event's dates (the end exclusive), or a timed one's instants.
 * `allDay` tells them apart; a save sends only `start` and `end`.
 */
export type DraftTimes =
  | { allDay: true; end: { date: string }; start: { date: string } }
  | { allDay: false; end: TimedTime; start: TimedTime };

/** A Google start or end as loaded. */
interface SourceTime {
  date?: string | null;
  dateTime?: string | null;
}

/**
 * A draft's start and end as Google takes them: dates for an all-day event
 * (the end exclusive), else instants in the event's zone. The form shows
 * and picks times in the app's zone. A time the form still shows as the
 * event had it keeps the event's own instant: in the hour a DST change
 * repeats, the wall time alone could mean either.
 */
export function draftTimes(
  draft: Pick<
    EventDraft,
    "allDay" | "endDate" | "endTime" | "startDate" | "startTime"
  >,
  /** The zone the form shows (and picks) times in. */
  appTimeZone: string,
  /** The zone the event keeps (`eventTimeZone`). */
  eventZone: string,
  /** The event's own start and end, when editing one. */
  source?: { end: SourceTime; start: SourceTime }
): DraftTimes {
  if (draft.allDay) {
    return {
      allDay: true,
      end: { date: draft.endDate.add({ days: 1 }).toString() },
      start: { date: draft.startDate.toString() },
    };
  }
  const at = (
    date: Temporal.PlainDate,
    time: Temporal.PlainTime,
    own: SourceTime | undefined
  ): TimedTime => {
    const shown = own?.dateTime
      ? Temporal.Instant.from(own.dateTime).toZonedDateTimeISO(appTimeZone)
      : null;
    const instant =
      shown?.toPlainDate().equals(date) && shown.toPlainTime().equals(time)
        ? shown.toInstant()
        : date
            .toZonedDateTime({ plainTime: time, timeZone: appTimeZone })
            .toInstant();
    return { dateTime: instant.toString(), timeZone: eventZone };
  };
  return {
    allDay: false,
    end: at(draft.endDate, draft.endTime ?? DEFAULT_END_TIME, source?.end),
    start: at(
      draft.startDate,
      draft.startTime ?? DEFAULT_START_TIME,
      source?.start
    ),
  };
}

/** The times a timed draft with none takes (an all-day event made timed). */
export const DEFAULT_START_TIME = Temporal.PlainTime.from("09:00");
export const DEFAULT_END_TIME = Temporal.PlainTime.from("10:00");
