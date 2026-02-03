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
import type { CalendarIdentifier } from "./visible-calendars";
import {
  visibleCalendarsAtom,
  visibleCalendarsModeAtom,
} from "./visible-calendars";

// --- Accounts ---

const googleAccountsAtom = atomWithQuery<Account[]>((get) => {
  const { authClient } = getStateConfig(get);
  const hasSession = get(hasSessionAtom);

  return {
    queryKey: ["google-accounts"],
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
  calendar: Calendar;
  accountId: string;
}

const googleCalendarsAtomFamily = atomFamily((accountId: string) =>
  atomWithQuery<CalendarWithSource[]>((get) => {
    const { orpc } = getStateConfig(get);
    const hasSession = get(hasSessionAtom);

    return {
      queryKey: ["google-calendars", accountId],
      enabled: hasSession,
      queryFn: async () => {
        const calendars = await orpc.googleCal.calendars.list.call({
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
    const stored = get(visibleCalendarsAtom);
    const calendars = get(googleCalendarsDataAtom);
    const mode = get(visibleCalendarsModeAtom);
    // Only honor the stored list when the user explicitly customized it.
    if (mode === "custom") {
      return stored;
    }
    return calendars.map((calendar) => ({
      accountId: calendar.accountId,
      calendarId: calendar.calendar.id,
    }));
  }
);

// --- Events per calendar + window ---

export interface GoogleEventWithSource {
  event: GoogleEvent;
  accountId: string;
  calendarId: string;
}
