import { Temporal } from "temporal-polyfill";
import type { EventDraft } from "@/components/calendar/calendar-editor-types";

interface DraftTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/**
 * A draft's start and end as Google takes them: dates for an all-day event
 * (the end exclusive), else instants in the event's zone. The form shows
 * and picks times in the app's zone.
 */
export function draftTimes(
  draft: Pick<
    EventDraft,
    "allDay" | "endDate" | "endTime" | "startDate" | "startTime"
  >,
  /** The zone the form shows (and picks) times in. */
  appTimeZone: string,
  /** The zone the event keeps (`eventTimeZone`). */
  eventZone: string
): { end: DraftTime; start: DraftTime } {
  if (draft.allDay) {
    return {
      end: { date: draft.endDate.add({ days: 1 }).toString() },
      start: { date: draft.startDate.toString() },
    };
  }
  const at = (date: Temporal.PlainDate, time: Temporal.PlainTime) => ({
    dateTime: date
      .toZonedDateTime({ plainTime: time, timeZone: appTimeZone })
      .toInstant()
      .toString(),
    timeZone: eventZone,
  });
  return {
    end: at(draft.endDate, draft.endTime ?? DEFAULT_END_TIME),
    start: at(draft.startDate, draft.startTime ?? DEFAULT_START_TIME),
  };
}

const DEFAULT_START_TIME = Temporal.PlainTime.from("09:00");
const DEFAULT_END_TIME = Temporal.PlainTime.from("10:00");
