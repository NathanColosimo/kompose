import type { CalendarIdentifier } from "./atoms/visible-calendars";

export interface GoogleEventsWindow {
  timeMax: string;
  timeMin: string;
}

export const GOOGLE_ACCOUNT_INFO_QUERY_KEY = ["google-account-info"] as const;
export const GOOGLE_CALENDARS_QUERY_KEY = ["google-calendars"] as const;
export const GOOGLE_COLORS_QUERY_KEY = ["google-colors"] as const;
export const GOOGLE_EVENTS_QUERY_KEY = ["google-events"] as const;
/** A recurring event's series (its master), as loaded for its editor. */
export const GOOGLE_EVENT_MASTER_QUERY_KEY = ["google-event-master"] as const;

/** The series loaded for one calendar's events. */
export function getGoogleEventMastersByCalendarQueryKey(
  calendar: CalendarIdentifier
) {
  return [
    ...GOOGLE_EVENT_MASTER_QUERY_KEY,
    calendar.accountId,
    calendar.calendarId,
  ] as const;
}

/**
 * After a write to a calendar's events: its listed events, and the series
 * loaded for them, are stale. A series kept fresh past its own edit would
 * hand its old rule to the next save (a new repeat undone by a move).
 */
export async function invalidateGoogleEventQueries(
  queryClient: {
    invalidateQueries: (filters: {
      queryKey: readonly unknown[];
    }) => Promise<unknown>;
  },
  calendars: CalendarIdentifier[]
): Promise<void> {
  await Promise.all(
    calendars.flatMap((calendar) => [
      queryClient.invalidateQueries({
        queryKey: getGoogleEventsByCalendarQueryKey(calendar),
      }),
      queryClient.invalidateQueries({
        queryKey: getGoogleEventMastersByCalendarQueryKey(calendar),
      }),
    ])
  );
}

export function getGoogleAccountInfoQueryKey(accountId: string) {
  return [...GOOGLE_ACCOUNT_INFO_QUERY_KEY, accountId] as const;
}

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
