import type { CalendarIdentifier } from "./atoms/visible-calendars";

export interface GoogleEventsWindow {
  timeMax: string;
  timeMin: string;
}

export const GOOGLE_ACCOUNTS_QUERY_KEY = ["google-accounts"] as const;
export const GOOGLE_CALENDARS_QUERY_KEY = ["google-calendars"] as const;
export const GOOGLE_COLORS_QUERY_KEY = ["google-colors"] as const;
export const GOOGLE_EVENTS_QUERY_KEY = ["google-events"] as const;

export function getGoogleCalendarsQueryKey(accountId: string) {
  return [...GOOGLE_CALENDARS_QUERY_KEY, accountId] as const;
}

export function getGoogleEventsQueryKey(
  calendar: CalendarIdentifier,
  window: GoogleEventsWindow
) {
  return [
    ...GOOGLE_EVENTS_QUERY_KEY,
    calendar.accountId,
    calendar.calendarId,
    window.timeMin,
    window.timeMax,
  ] as const;
}

export function getGoogleEventsByCalendarQueryKey(
  calendar: CalendarIdentifier
) {
  return [
    ...GOOGLE_EVENTS_QUERY_KEY,
    calendar.accountId,
    calendar.calendarId,
  ] as const;
}

export function getGoogleColorsQueryKey(accountId: string) {
  return [...GOOGLE_COLORS_QUERY_KEY, accountId] as const;
}
