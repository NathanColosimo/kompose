import { Temporal } from "temporal-polyfill";
import type { EventDraft } from "@/components/calendar/calendar-editor-types";

interface DraftTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

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
): { end: DraftTime; start: DraftTime } {
  if (draft.allDay) {
    return {
      end: { date: draft.endDate.add({ days: 1 }).toString() },
      start: { date: draft.startDate.toString() },
    };
  }
  const at = (
    date: Temporal.PlainDate,
    time: Temporal.PlainTime,
    own: SourceTime | undefined
  ): DraftTime => {
    const shown = own?.dateTime
      ? Temporal.Instant.from(own.dateTime).toZonedDateTimeISO(appTimeZone)
      : null;
    const instant =
      shown &&
      shown.toPlainDate().equals(date) &&
      shown.toPlainTime().equals(time)
        ? shown.toInstant()
        : date
            .toZonedDateTime({ plainTime: time, timeZone: appTimeZone })
            .toInstant();
    return { dateTime: instant.toString(), timeZone: eventZone };
  };
  return {
    end: at(draft.endDate, draft.endTime ?? DEFAULT_END_TIME, source?.end),
    start: at(
      draft.startDate,
      draft.startTime ?? DEFAULT_START_TIME,
      source?.start
    ),
  };
}

const DEFAULT_START_TIME = Temporal.PlainTime.from("09:00");
const DEFAULT_END_TIME = Temporal.PlainTime.from("10:00");
