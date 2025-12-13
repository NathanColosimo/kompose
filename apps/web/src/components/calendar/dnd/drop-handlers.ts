import type { TaskSelect } from "@kompose/db/schema/task";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { Temporal } from "temporal-polyfill";
import type { UpdateGoogleEventInput } from "@/hooks/use-google-event-mutations";
import { isoStringToZonedDateTime, isSameDay } from "@/lib/temporal-utils";
import { clampResizeEnd, clampResizeStart, durationInMinutes } from "./helpers";
import type { DragData, DragDirection } from "./types";

/** Build task move update payload */
export function buildTaskMoveUpdate(
  task: TaskSelect,
  startTime: Temporal.ZonedDateTime
) {
  return {
    id: task.id,
    task: {
      // Store as local datetime (Postgres timestamp without timezone)
      startTime: startTime.toPlainDateTime().toString(),
      durationMinutes: task.durationMinutes,
    },
  };
}

/** Build task resize update payload */
export function buildTaskResizeUpdate({
  task,
  targetDateTime,
  direction,
  timeZone,
}: {
  task: TaskSelect;
  targetDateTime: Temporal.ZonedDateTime;
  direction: DragDirection;
  timeZone: string;
}) {
  if (!task.startTime) {
    return null;
  }

  // Parse task.startTime (ISO string) to ZonedDateTime
  const originalStart = isoStringToZonedDateTime(task.startTime, timeZone);
  const originalEnd = originalStart.add({ minutes: task.durationMinutes });

  if (!isSameDay(originalStart, targetDateTime)) {
    return null;
  }

  if (direction === "start") {
    const newStart = clampResizeStart(
      targetDateTime,
      originalStart,
      originalEnd
    );
    const newDuration = durationInMinutes(newStart, originalEnd);
    return {
      id: task.id,
      task: {
        // Store as local datetime (Postgres timestamp without timezone)
        startTime: newStart.toPlainDateTime().toString(),
        durationMinutes: newDuration,
      },
    };
  }

  const newEnd = clampResizeEnd(targetDateTime, originalStart);
  const newDuration = durationInMinutes(originalStart, newEnd);
  return {
    id: task.id,
    task: {
      // Store as local datetime (Postgres timestamp without timezone)
      startTime: originalStart.toPlainDateTime().toString(),
      durationMinutes: newDuration,
    },
  };
}

/** Build Google event update payload with new start/end times */
export function buildGoogleUpdatePayload(
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
    start: {
      ...event.event.start,
      dateTime: start.toInstant().toString(),
      date: undefined,
    },
    end: {
      ...event.event.end,
      dateTime: end.toInstant().toString(),
      date: undefined,
    },
  };
}

/** Build Google event move update */
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
    eventId: data.event.id,
    event,
  };
}

/** Build Google event resize update */
export function buildGoogleResizeUpdate({
  data,
  targetDateTime,
}: {
  data: Extract<DragData, { type: "google-event-resize" }>;
  targetDateTime: Temporal.ZonedDateTime;
}) {
  const originalStart = data.start;
  const originalEnd = data.end;

  if (!isSameDay(originalStart, targetDateTime)) {
    return null;
  }

  if (data.direction === "start") {
    const newStart = clampResizeStart(
      targetDateTime,
      originalStart,
      originalEnd
    );
    const event = buildGoogleUpdatePayload(data, newStart, originalEnd);
    return {
      accountId: data.accountId,
      calendarId: data.calendarId,
      eventId: data.event.id,
      event,
    };
  }

  const newEnd = clampResizeEnd(targetDateTime, originalStart);
  const event = buildGoogleUpdatePayload(data, originalStart, newEnd);
  return {
    accountId: data.accountId,
    calendarId: data.calendarId,
    eventId: data.event.id,
    event,
  };
}
