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
import {
  type CalendarIdentifier,
  visibleCalendarsAtom,
  visibleCalendarsHydratedAtom,
} from "./visible-calendars";

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
      const accounts = (await authClient.listAccounts())?.data ?? [];
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
    const query = get(googleCalendarsAtomFamily(account.accountId));
    return query.data ?? [];
  });
});

export const resolvedVisibleCalendarIdsAtom = atom<CalendarIdentifier[]>(
  (get) => {
    const hydrated = get(visibleCalendarsHydratedAtom);
    if (!hydrated) {
      return [];
    }

    const accounts = get(googleAccountsDataAtom);
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

    const accountsQuery = get(googleAccountsAtom);
    const hasResolvedAccounts =
      accountsQuery.data !== undefined || accountsQuery.error != null;
    if (!hasResolvedAccounts) {
      return stored;
    }

    const linkedAccountIds = new Set(
      (accountsQuery.data ?? []).map((account) => account.accountId)
    );
    const accountFiltered = stored.filter((calendar) =>
      linkedAccountIds.has(calendar.accountId)
    );

    const allCalendarQueriesResolved = accounts.every((account) => {
      const query = get(googleCalendarsAtomFamily(account.accountId));
      return query.data !== undefined || query.error != null;
    });
    if (!allCalendarQueriesResolved) {
      return accountFiltered;
    }

    const validKeys = new Set(
      allCalendarIds.map((calendar) => toCalendarKey(calendar))
    );
    return accountFiltered.filter((calendar) =>
      validKeys.has(toCalendarKey(calendar))
    );
  }
);

// --- Events per calendar + window ---

export interface GoogleEventWithSource {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
}
