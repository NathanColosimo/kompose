import { CreateEvent, Event } from "./schema";


const STRIP_TIME_SEPARATORS = /[-:]/g;
const STRIP_MILLIS_SUFFIX = /\.\d{3}Z$/;
const UNTIL_REGEX = /UNTIL=[^;]+/;

export function truncateRecurrenceForFollowing(
  recurrence: string[],
  occurrenceStart: Date,
  allDay: boolean
): string[] {
  const baseRule = recurrence[0];

  if (!baseRule) {
    return recurrence;
  }

  const untilDate = new Date(occurrenceStart);
  // For all-day, stop the original series at the prior day; for timed, stop one second before.
  if (allDay) {
    untilDate.setDate(untilDate.getDate() - 1);
    untilDate.setHours(0, 0, 0, 0);
  } else {
    untilDate.setSeconds(untilDate.getSeconds() - 1);
  }
  const untilIso = untilDate
    .toISOString()
    .replace(STRIP_TIME_SEPARATORS, "")
    .replace(STRIP_MILLIS_SUFFIX, "Z");

  const nextRule = baseRule.includes("UNTIL=")
    ? baseRule.replace(UNTIL_REGEX, `UNTIL=${untilIso}`)
    : `${baseRule};UNTIL=${untilIso}`;

  return [nextRule, ...recurrence.slice(1)];
}

 // Strip server-managed fields so create/update inputs stay valid.
export function sanitizeEventPayload(event: Event): CreateEvent {
  const {
    id: _id,
    htmlLink: _htmlLink,
    organizer: _organizer,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    ...rest
  } = event;
  return rest;
}

export function stripRecurringLink(event: CreateEvent): CreateEvent {
  const { recurringEventId: _recurringEventId, originalStartTime: _originalStartTime, ...rest } =
    event;
  return rest;
}