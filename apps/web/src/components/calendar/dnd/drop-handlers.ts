import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { Temporal } from "temporal-polyfill";
import type { UpdateGoogleEventInput } from "@/hooks/use-google-event-mutations";
import { isSameDay } from "@/lib/temporal-utils";
import { clampResizeEnd, clampResizeStart, durationInMinutes } from "./helpers";
import type { DragData, DragDirection } from "./types";

/** Build task move update payload - returns decoded types (Temporal) */
export function buildTaskMoveUpdate(
  task: TaskSelectDecoded,
  targetDateTime: Temporal.ZonedDateTime
) {
  return {
    id: task.id,
    task: {
      // Separate date and time for new schema
      startDate: targetDateTime.toPlainDate(),
      startTime: targetDateTime.toPlainTime(),
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
  task: TaskSelectDecoded;
  targetDateTime: Temporal.ZonedDateTime;
  direction: DragDirection;
  timeZone: string;
}) {
  // Need both startDate and startTime for a scheduled task
  if (!(task.startDate && task.startTime)) {
    return null;
  }

  // Combine startDate + startTime into ZonedDateTime
  const originalStart = task.startDate.toZonedDateTime({
    timeZone,
    plainTime: task.startTime,
  });
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
        // Separate date and time for new schema
        startDate: newStart.toPlainDate(),
        startTime: newStart.toPlainTime(),
        durationMinutes: newDuration,
      },
    };
  }

  const newEnd = clampResizeEnd(targetDateTime, originalStart);
  const newDuration = durationInMinutes(originalStart, newEnd);
  return {
    id: task.id,
    task: {
      // Separate date and time for new schema (date unchanged for end resize)
      startDate: originalStart.toPlainDate(),
      startTime: originalStart.toPlainTime(),
      durationMinutes: newDuration,
    },
  };
}

/** Build Google event update payload with new start/end times */
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
