import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { getGoogleEventsByCalendarQueryKey } from "@kompose/state/google-calendar-query-keys";
import {
  entireSeriesCost,
  entireSeriesMovesSeveralADay,
  entireSeriesStartMoves,
  GOOGLE_EVENT_WEEKDAYS,
  occurrenceDayMoved,
  otherTimeZone,
  repeatSkipsOccurrence,
  seriesRecurrenceForSave,
} from "@kompose/state/google-event-recurrence";
import {
  type EventSaveChanges,
  opensSeries,
  seriesMeetsSeveralTimesADay,
} from "@kompose/state/recurrence-scope-options";
import { seriesEditFields } from "@kompose/state/series-edit";
import type { QueryClient } from "@tanstack/react-query";
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

/**
 * What a save sends for `scope`, as #125's server reads it. One occurrence
 * ("this") gets the whole edit: the occurrence as loaded, with the form's
 * values. For the series ("following", "all") through an occurrence:
 * - its id and its times as they are: the occurrence's own times mean
 *   unchanged, and under This and following a moved one stays moved;
 * - only the fields the user changed (`seriesEditFields`): a field left
 *   out, or empty where the occurrence had none, is unchanged, and a
 *   cleared one goes empty, which clears the series' too;
 * - a repeat only when the user changed it, or the day moved and the
 *   series' rule follows the new day (`seriesRecurrenceForSave`).
 * Guests, reminders and anything else left alone stay out, and the server
 * fills them from the series.
 */
export function eventForScope({
  edited,
  master,
  occurrence,
  scope,
  timeZone,
}: {
  /** The save built from the form or the drop. */
  edited: GoogleEvent;
  /** The series' own rule and start, once loaded. */
  master: Pick<GoogleEvent, "recurrence" | "start"> | undefined;
  /** The event the edit started from, as loaded. */
  occurrence: GoogleEvent | undefined;
  scope: RecurrenceScope;
  timeZone: string;
}): GoogleEvent {
  if (scope === "this" || !occurrence?.recurringEventId) {
    return edited;
  }
  const recurrence =
    edited.recurrence ??
    seriesRecurrenceForSave({
      editedEnd: edited.end,
      editedStart: edited.start,
      masterRecurrence: master?.recurrence,
      masterStart: master?.start,
      occurrence,
      recurrence: undefined,
      timeZone,
    });
  return {
    // Fields left as they were come back undefined, which the request
    // leaves out, so the series keeps its own.
    ...seriesEditFields({
      edited: { ...edited, summary: edited.summary ?? "" },
      occurrence,
    }),
    id: edited.id,
    ...(recurrence ? { recurrence } : {}),
  };
}

/**
 * What a recurring event's save changes, for the scopes its dialog offers
 * (#127's `EventSaveChanges`), as the server will read it: from what the
 * save sends (its times, and its repeat when it sends one), the series as
 * loaded (`master`, once it is), and the series' occurrences in the events
 * cache (`loaded`, the opened one too). Shared by the editor and drops.
 */
export function saveFacts({
  edited,
  event,
  loaded,
  master,
  timeZone,
}: {
  edited: Pick<GoogleEvent, "end" | "recurrence" | "start">;
  /** The event the edit started from, as loaded. */
  event: GoogleEvent;
  loaded: GoogleEvent[];
  master: GoogleEvent | undefined;
  /** The app's zone. */
  timeZone: string;
}): Pick<
  EventSaveChanges,
  | "dateMoved"
  | "entireSeriesCost"
  | "movesSeveralADay"
  | "opensSeries"
  | "repeatSkips"
  | "retimed"
  | "seriesTimeZone"
  | "severalRules"
> {
  const seriesStart = master?.start;
  const seriesTimeZone = otherTimeZone(event, timeZone, seriesStart);
  if (!event.recurringEventId) {
    return { dateMoved: false, seriesTimeZone };
  }
  const times = { end: edited.end, start: edited.start };
  const { recurrence } = edited;
  return {
    dateMoved: occurrenceDayMoved({
      editedEnd: edited.end,
      editedStart: edited.start,
      occurrence: event,
      seriesStart,
      timeZone,
    }),
    entireSeriesCost: master
      ? entireSeriesCost({
          edited: times,
          loaded,
          master,
          occurrence: event,
          recurrence,
          timeZone,
        })
      : null,
    movesSeveralADay: master
      ? entireSeriesMovesSeveralADay({
          edited: times,
          master,
          occurrence: event,
          timeZone,
        })
      : undefined,
    opensSeries: opensSeries(event, master, timeZone),
    repeatSkips: repeatSkipsOccurrence({
      occurrence: event,
      recurrence,
      seriesStart,
      timeZone,
    }),
    retimed: entireSeriesStartMoves({
      edited: times,
      master: master ?? null,
      occurrence: event,
      timeZone,
    }),
    severalRules: master
      ? seriesMeetsSeveralTimesADay(master, timeZone)
      : undefined,
    seriesTimeZone,
  };
}

/**
 * The series' occurrences in the events cache (the opened one too), for
 * what an Entire series save would cost those changed on their own
 * (`entireSeriesCost`).
 */
export function cachedOccurrences(
  queryClient: QueryClient,
  calendar: { accountId: string; calendarId: string },
  event: GoogleEvent | undefined
): GoogleEvent[] {
  const seriesId = event?.recurringEventId;
  if (!seriesId) {
    return [];
  }
  return queryClient
    .getQueriesData<GoogleEvent[]>({
      queryKey: getGoogleEventsByCalendarQueryKey(calendar),
    })
    .flatMap(([, events]) => events ?? [])
    .filter((cached) => cached.recurringEventId === seriesId);
}
