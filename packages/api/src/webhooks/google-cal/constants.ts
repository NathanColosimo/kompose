import { env } from "@kompose/env";
import type { PluginId, PluginProvider } from "@kompose/plugins";

export const GOOGLE_PROVIDER = "google" satisfies PluginProvider;

export const GOOGLE_CHANNEL_TTL_MS = 28 * 24 * 60 * 60 * 1000;
export const GOOGLE_RENEWAL_BUFFER_MS = 12 * 60 * 60 * 1000;

export const GOOGLE_WEBHOOK_CALLBACK_URL = `${env.NEXT_PUBLIC_WEB_URL}/api/webhooks/${"google-calendar" satisfies PluginId}`;

const GOOGLE_GROUP_CALENDAR_SUFFIX = "@group.v.calendar.google.com";

export function isGoogleHolidayCalendarId(calendarId: string): boolean {
  return (
    calendarId.includes("#holiday@") &&
    calendarId.endsWith(GOOGLE_GROUP_CALENDAR_SUFFIX)
  );
}
