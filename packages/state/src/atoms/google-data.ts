import type {
  Calendar,
  Event as GoogleEvent,
} from "@kompose/google-cal/schema";
import { keepPreviousData } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithQuery } from "jotai-tanstack-query";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { getStateConfig } from "../config";
import { getGoogleCalendarsQueryKey } from "../google-calendar-query-keys";
import {
  type CalendarIdentifier,
  visibleCalendarsAtom,
  visibleCalendarsHydratedAtom,
} from "./visible-calendars";

function toCalendarKey(calendar: CalendarIdentifier) {
  return `${calendar.accountId}:${calendar.calendarId}`;
}

const linkedAccountsAtom = atomWithQuery<Account[]>((get) => {
  const { authClient } = getStateConfig(get);

  return {
    placeholderData: keepPreviousData,
    queryFn: () => authClient.listAccounts(),
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    staleTime: 1000 * 60 * 5,
  };
});

export const linkedAccountsDataAtom = atom<Account[]>(
  (get) => get(linkedAccountsAtom).data ?? []
);

export const googleAccountsDataAtom = atom<Account[]>((get) =>
  get(linkedAccountsDataAtom).filter(
    (account) => account.providerId === "google"
  )
);

export interface CalendarWithSource {
  accountId: string;
  calendar: Calendar;
}

const googleCalendarsAtomFamily = atomFamily((accountId: string) =>
  atomWithQuery<CalendarWithSource[]>((get) => {
    const { orpc } = getStateConfig(get);

    return {
      placeholderData: keepPreviousData,
      queryFn: async () => {
        const calendars = await orpc.googleCal.calendars.list({
          accountId,
        });

        return calendars.map((calendar) => ({
          accountId,
          calendar,
        }));
      },
      queryKey: getGoogleCalendarsQueryKey(accountId),
      staleTime: 5 * 60 * 1000,
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

/**
 * True until the linked accounts, each Google account's calendars, and the
 * saved calendar choice have loaded once.
 */
export const googleCalendarsLoadingAtom = atom((get) => {
  if (!get(visibleCalendarsHydratedAtom) || get(linkedAccountsAtom).isPending) {
    return true;
  }
  return get(googleAccountsDataAtom).some(
    (account) => get(googleCalendarsAtomFamily(account.accountId)).isPending
  );
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

    const accountsQuery = get(linkedAccountsAtom);
    const hasResolvedAccounts = accountsQuery.isSuccess;
    if (!hasResolvedAccounts) {
      return stored;
    }

    const linkedAccountIds = new Set(
      (accountsQuery.data ?? [])
        .filter((account) => account.providerId === "google")
        .map((account) => account.accountId)
    );
    const accountFiltered = stored.filter((calendar) =>
      linkedAccountIds.has(calendar.accountId)
    );

    // Filter the live view without rewriting preferences. An empty account
    // response during sign-out or a failed refresh must not erase saved choices.

    const allCalendarQueriesResolved = accounts.every((account) => {
      const query = get(googleCalendarsAtomFamily(account.accountId));
      return query.data !== undefined || query.isError;
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

export interface GoogleEventWithSource {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
}
