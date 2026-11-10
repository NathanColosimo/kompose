import {
  type Event,
  getGoogleEventEditBlockReason,
} from "@kompose/google-cal/schema";

const READ_ONLY_ROLES = new Set(["freeBusyReader", "reader"]);

export function canWriteCalendar(
  accessRole: string | null | undefined
): boolean {
  return !(accessRole && READ_ONLY_ROLES.has(accessRole));
}

/** The UI also respects the calendar's access role when it is loaded. */
export function calendarEventEditBlockReason(
  event: Event,
  accessRole?: string | null
): string | null {
  if (!canWriteCalendar(accessRole)) {
    return "You can only view this calendar, so its events can't be edited here.";
  }
  return getGoogleEventEditBlockReason(event);
}
