import { env } from "@kompose/env";

export const GOOGLE_PROVIDER = "google" as const;

export const GOOGLE_CHANNEL_TTL_MS = 28 * 24 * 60 * 60 * 1000;
export const GOOGLE_RENEWAL_BUFFER_MS = 12 * 60 * 60 * 1000;

export const GOOGLE_WEBHOOK_PATH = "/api/webhooks/google-calendar";
export const GOOGLE_WEBHOOK_CALLBACK_URL = `${env.NEXT_PUBLIC_WEB_URL}${GOOGLE_WEBHOOK_PATH}`;

const GOOGLE_GROUP_CALENDAR_SUFFIX = "@group.v.calendar.google.com";

export function isGoogleHolidayCalendarId(calendarId: string): boolean {
  return (
    calendarId.includes("#holiday@") &&
    calendarId.endsWith(GOOGLE_GROUP_CALENDAR_SUFFIX)
  );
}

export function isGoogleCalendarEventsWatchSupported(
  calendarId: string
): boolean {
  return !isGoogleHolidayCalendarId(calendarId);
}
