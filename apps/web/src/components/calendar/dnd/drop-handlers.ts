import type { TaskSelect } from "@kompose/db/schema/task";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { UpdateGoogleEventInput } from "@/hooks/use-google-event-mutations";
import {
  clampResizeEnd,
  clampResizeStart,
  durationInMinutes,
  isSameDayLocal,
  MS_PER_MINUTE,
} from "./helpers";
import type { DragData, DragDirection } from "./types";

export function buildTaskMoveUpdate(task: TaskSelect, startTime: Date) {
  return {
    id: task.id,
    task: {
      startTime,
      durationMinutes: task.durationMinutes,
    },
  };
}

export function buildTaskResizeUpdate({
  task,
  targetDateTime,
  direction,
}: {
  task: TaskSelect;
  targetDateTime: Date;
  direction: DragDirection;
}) {
  if (!task.startTime) {
    return null;
  }

  const originalStart = new Date(task.startTime);
  const originalEnd = new Date(
    originalStart.getTime() + task.durationMinutes * MS_PER_MINUTE
  );

  if (!isSameDayLocal(originalStart, targetDateTime)) {
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
        startTime: newStart,
        durationMinutes: newDuration,
      },
    };
  }

  const newEnd = clampResizeEnd(targetDateTime, originalStart);
  const newDuration = durationInMinutes(originalStart, newEnd);
  return {
    id: task.id,
    task: {
      startTime: originalStart,
      durationMinutes: newDuration,
    },
  };
}

export function buildGoogleUpdatePayload(
  event: DragData & { type: "google-event" | "google-event-resize" },
  start: Date,
  end: Date
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
      dateTime: start.toISOString(),
      date: undefined,
    },
    end: { ...event.event.end, dateTime: end.toISOString(), date: undefined },
  };
}

export function buildGoogleMoveUpdate(
  data: Extract<DragData, { type: "google-event" }>,
  start: Date
): UpdateGoogleEventInput {
  const durationMinutes =
    (data.end.getTime() - data.start.getTime()) / (60 * 1000);
  const newEnd = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const event = buildGoogleUpdatePayload(data, start, newEnd);

  return {
    accountId: data.accountId,
    calendarId: data.calendarId,
    eventId: data.event.id,
    event,
  };
}

export function buildGoogleResizeUpdate({
  data,
  targetDateTime,
}: {
  data: Extract<DragData, { type: "google-event-resize" }>;
  targetDateTime: Date;
}) {
  const originalStart = data.start;
  const originalEnd = data.end;

  if (!isSameDayLocal(originalStart, targetDateTime)) {
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
