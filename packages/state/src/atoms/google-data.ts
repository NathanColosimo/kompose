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
    const linkedAccountIds = new Set(
      accounts.map((account) => account.accountId)
    );
    const discoveredCalendarIds = new Map<string, Set<string>>();
    for (const account of accounts) {
      const query = get(googleCalendarsAtomFamily(account.accountId));
      if (query.isSuccess) {
        discoveredCalendarIds.set(
          account.accountId,
          new Set(query.data.map(({ calendar }) => calendar.id))
        );
      }
    }

    // Only successful discovery proves an account or calendar is gone.
    // Keep saved preferences intact when deriving the live selection.
    return stored.filter((calendar) => {
      if (
        accountsQuery.isSuccess &&
        !linkedAccountIds.has(calendar.accountId)
      ) {
        return false;
      }
      return (
        discoveredCalendarIds
          .get(calendar.accountId)
          ?.has(calendar.calendarId) ?? true
      );
    });
  }
);

export interface GoogleEventWithSource {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
}
