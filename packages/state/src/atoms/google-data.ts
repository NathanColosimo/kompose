import type {
  Calendar,
  Event as GoogleEvent,
} from "@kompose/google-cal/schema";
import { keepPreviousData } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig, hasSessionAtom } from "../config";
import {
  GOOGLE_ACCOUNTS_QUERY_KEY,
  getGoogleCalendarsQueryKey,
} from "../google-calendar-query-keys";
import type { CalendarIdentifier } from "./visible-calendars";
import { visibleCalendarsAtom } from "./visible-calendars";

function toCalendarKey(calendar: CalendarIdentifier) {
  return `${calendar.accountId}:${calendar.calendarId}`;
}

// --- Accounts ---

const googleAccountsAtom = atomWithQuery<Account[]>((get) => {
  const { authClient } = getStateConfig(get);
  const hasSession = get(hasSessionAtom);

  return {
    queryKey: GOOGLE_ACCOUNTS_QUERY_KEY,
    enabled: hasSession,
    queryFn: async () => {
      const result = await authClient.listAccounts();
      const accounts = result?.data ?? [];
      return accounts.filter((account) => account.providerId === "google");
    },
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  };
});

export const googleAccountsDataAtom = atom(
  (get) => get(googleAccountsAtom).data ?? []
);

// --- Calendars per account ---

export interface CalendarWithSource {
  accountId: string;
  calendar: Calendar;
}

const googleCalendarsAtomFamily = atomFamily((accountId: string) =>
  atomWithQuery<CalendarWithSource[]>((get) => {
    const { orpc } = getStateConfig(get);
    const hasSession = get(hasSessionAtom);

    return {
      queryKey: getGoogleCalendarsQueryKey(accountId),
      enabled: hasSession,
      queryFn: async () => {
        const calendars = await orpc.googleCal.calendars.list({
          accountId,
        });

        return calendars.map((calendar) => ({
          calendar,
          accountId,
        }));
      },
      staleTime: 5 * 60 * 1000,
      placeholderData: keepPreviousData,
    };
  })
);

export const googleCalendarsDataAtom = atom<CalendarWithSource[]>((get) => {
  const accounts = get(googleAccountsDataAtom);
  return accounts.flatMap((account) => {
    const query = get(googleCalendarsAtomFamily(account.id));
    return query.data ?? [];
  });
});

export const resolvedVisibleCalendarIdsAtom = atom<CalendarIdentifier[]>(
  (get) => {
    const calendars = get(googleCalendarsDataAtom);
    const allCalendarIds = calendars.map((calendar) => ({
      accountId: calendar.accountId,
      calendarId: calendar.calendar.id,
    }));

    const stored = get(visibleCalendarsAtom);
    if (stored === null) {
      return allCalendarIds;
    }

    if (stored.length === 0) {
      return [];
    }

    const validKeys = new Set(allCalendarIds.map(toCalendarKey));
    const filtered = stored.filter((calendar) =>
      validKeys.has(toCalendarKey(calendar))
    );

    // Stale persisted selections (e.g. after DB reset/re-link) should not block
    // events from loading; fall back to all currently available calendars.
    if (filtered.length === 0 && allCalendarIds.length > 0) {
      return allCalendarIds;
    }

    return filtered;
  }
);

// --- Events per calendar + window ---

export interface GoogleEventWithSource {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
}
