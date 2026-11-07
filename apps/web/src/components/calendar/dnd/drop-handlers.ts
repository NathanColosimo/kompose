import type {
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { UpdateGoogleEventInput } from "@kompose/state/hooks/use-google-event-mutations";
import type { Temporal } from "temporal-polyfill";
import { durationInMinutes, resizedRange } from "./helpers";
import type { DragData, DragDirection } from "./types";

export function buildTaskMoveUpdate(
  task: TaskSelectDecoded,
  targetDateTime: Temporal.ZonedDateTime
): { id: string; task: object; scope: UpdateScope } {
  return {
    id: task.id,
    // Default scope; CalendarDndProvider asks for scope on recurring tasks.
    scope: "this",
    task: {
      durationMinutes: task.durationMinutes,
      startDate: targetDateTime.toPlainDate(),
      startTime: targetDateTime.toPlainTime(),
    },
  };
}

export function buildTaskResizeUpdate({
  task,
  targetDateTime,
  direction,
  timeZone,
}: {
  task: TaskSelectDecoded;
  targetDateTime: Temporal.ZonedDateTime;
  direction: DragDirection;
  timeZone: string;
}): { id: string; task: object; scope: UpdateScope } | null {
  if (!(task.startDate && task.startTime)) {
    return null;
  }

  const originalStart = task.startDate.toZonedDateTime({
    plainTime: task.startTime,
    timeZone,
  });
  const range = resizedRange({
    direction,
    end: originalStart.add({ minutes: task.durationMinutes }),
    start: originalStart,
    target: targetDateTime,
  });
  if (!range) {
    return null;
  }
  return {
    id: task.id,
    scope: "this",
    task: {
      durationMinutes: durationInMinutes(range.start, range.end),
      startDate: range.start.toPlainDate(),
      startTime: range.start.toPlainTime(),
    },
  };
}

/** Keep the UTC offset but omit Temporal annotations that Google does not accept. */
function toGoogleDateTime(dateTime: Temporal.ZonedDateTime): string {
  return dateTime.toString({
    calendarName: "never",
    timeZoneName: "never",
  });
}

function buildGoogleUpdatePayload(
  event: DragData & { type: "google-event" | "google-event-resize" },
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime
): GoogleEvent {
  const {
    id: _id,
    htmlLink: _htmlLink,
    organizer: _organizer,
    ...rest
  } = event.event;

  return {
    id: event.event.id,
    ...rest,
    end: {
      date: undefined,
      dateTime: toGoogleDateTime(end),
      timeZone: end.timeZoneId,
    },
    start: {
      date: undefined,
      dateTime: toGoogleDateTime(start),
      timeZone: start.timeZoneId,
    },
  };
}

export function buildGoogleMoveUpdate(
  data: Extract<DragData, { type: "google-event" }>,
  start: Temporal.ZonedDateTime
): UpdateGoogleEventInput {
  const durationMins = Math.round(
    data.end.since(data.start).total({ unit: "minutes" })
  );
  const newEnd = start.add({ minutes: durationMins });
  const event = buildGoogleUpdatePayload(data, start, newEnd);

  return {
    accountId: data.accountId,
    calendarId: data.calendarId,
    event,
    eventId: data.event.id,
  };
}

export function buildGoogleResizeUpdate({
  data,
  targetDateTime,
}: {
  data: Extract<DragData, { type: "google-event-resize" }>;
  targetDateTime: Temporal.ZonedDateTime;
}) {
  const range = resizedRange({
    direction: data.direction,
    end: data.end,
    start: data.start,
    target: targetDateTime,
  });
  if (!range) {
    return null;
  }
  return {
    accountId: data.accountId,
    calendarId: data.calendarId,
    event: buildGoogleUpdatePayload(data, range.start, range.end),
    eventId: data.event.id,
  };
}
