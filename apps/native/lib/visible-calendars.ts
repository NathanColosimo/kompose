// biome-ignore lint/performance/noNamespaceImport: SecureStore is a namespace object
import * as SecureStore from "expo-secure-store";

/**
 * Identifies a Google calendar within a specific linked Google account.
 *
 * - `accountId`: Better Auth account id (not the Google email)
 * - `calendarId`: Google Calendar id
 */
export interface CalendarIdentifier {
  accountId: string;
  calendarId: string;
}

const STORAGE_KEY = "visible-calendars";

/**
 * Persisted calendar visibility selection.
 *
 * - `[]`: explicitly hide all calendars
 * - `[...ids]`: only those calendars visible
 */
export type VisibleCalendars = CalendarIdentifier[];

export async function loadVisibleCalendars(): Promise<VisibleCalendars> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    // We only store an array.
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Basic validation - keep it defensive.
    const cleaned: CalendarIdentifier[] = parsed
      .filter((item): item is CalendarIdentifier => {
        if (typeof item !== "object" || item === null) {
          return false;
        }
        const record = item as Record<string, unknown>;
        return (
          typeof record.accountId === "string" &&
          typeof record.calendarId === "string"
        );
      })
      .map((item) => ({
        accountId: item.accountId,
        calendarId: item.calendarId,
      }));
    return cleaned;
  } catch {
    return [];
  }
}

export async function saveVisibleCalendars(value: VisibleCalendars) {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value));
}

export function isCalendarVisible(
  visibleCalendars: VisibleCalendars,
  accountId: string,
  calendarId: string
): boolean {
  // Explicitly hide all.
  if (visibleCalendars.length === 0) {
    return false;
  }
  return visibleCalendars.some(
    (c) => c.accountId === accountId && c.calendarId === calendarId
  );
}

export function toggleCalendarSelection(
  prev: CalendarIdentifier[],
  target: CalendarIdentifier
): CalendarIdentifier[] {
  // If the user had an explicit empty set (hidden all), toggling should show just the clicked one.
  if (prev.length === 0) {
    return [target];
  }

  const exists = prev.some(
    (c) =>
      c.accountId === target.accountId && c.calendarId === target.calendarId
  );

  return exists
    ? prev.filter(
        (c) =>
          !(
            c.accountId === target.accountId &&
            c.calendarId === target.calendarId
          )
      )
    : [...prev, target];
}
