import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import {
  GOOGLE_EVENT_WEEKDAYS,
  seriesRecurrenceForSave,
} from "@kompose/state/google-event-recurrence";
import {
  type EventSaveChanges,
  eventSaveDescription,
  eventSaveDisabledScopes,
} from "@kompose/state/recurrence-scope-options";
import { seriesEditFields } from "@kompose/state/series-edit";
import { ORPCError } from "@orpc/client";
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
 * The server's refusal of a series write, from a failed save: a
 * BAD_REQUEST whose data says why (packages/google-cal's SeriesRefusal),
 * worded in its message. A retry won't help, so the editor shows it.
 */
export function seriesRefusal(
  error: unknown
): { message: string; reason: unknown } | null {
  if (!(error instanceof ORPCError && error.code === "BAD_REQUEST")) {
    return null;
  }
  const data: unknown = error.data;
  if (!(typeof data === "object" && data !== null && "reason" in data)) {
    return null;
  }
  return { message: error.message, reason: data.reason };
}

/** The scopes the server refused for one pending save, and its latest reason. */
export interface Refusals {
  message: string;
  scopes: Partial<Record<RecurrenceScope, true>>;
}

/** `refused` with `scope` refused too, for `message`. */
export function refuse(
  refused: Refusals | null,
  scope: RecurrenceScope,
  message: string
): Refusals {
  return { message, scopes: { ...refused?.scopes, [scope]: true } };
}

/**
 * The save scope dialog: the shared rules and the line saying why each
 * scope that's off is, plus the scopes the server refused for this save,
 * turned off and led by its latest reason.
 */
export function saveScopeDialog(
  changes: EventSaveChanges,
  refused: Refusals | null
): {
  description: string;
  disabled: Partial<Record<RecurrenceScope, boolean>>;
} {
  const description = eventSaveDescription(changes);
  const disabled = eventSaveDisabledScopes(changes);
  return refused
    ? {
        description: `${refused.message} ${description}`,
        disabled: { ...disabled, ...refused.scopes },
      }
    : { description, disabled };
}
