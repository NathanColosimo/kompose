import type {
  Calendar,
  Event as GoogleEvent,
} from "@kompose/google-cal/schema";
import type { Account } from "better-auth";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import { atomWithQuery } from "jotai-tanstack-query";
import {
  isCalendarVisibleAtom,
  visibleCalendarsAtom,
} from "@/atoms/visible-calendars";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import type { CalendarIdentifier } from "./visible-calendars";

// --- Accounts ---

export const googleAccountsAtom = atomWithQuery<Account[]>(() => ({
  queryKey: ["google-accounts"],
  queryFn: async () => {
    const result = await authClient.listAccounts();
    const accounts = result?.data ?? [];
    return accounts.filter((account) => account.providerId === "google");
  },
  staleTime: 1000 * 60 * 5,
  keepPreviousData: true,
}));

export const googleAccountsDataAtom = atom(
  (get) => get(googleAccountsAtom).data ?? []
);

// --- Calendars per account ---

export type CalendarWithSource = {
  calendar: Calendar;
  accountId: string;
};

export const googleCalendarsAtomFamily = atomFamily((accountId: string) =>
  atomWithQuery<CalendarWithSource[]>(() => ({
    queryKey: ["google-calendars", accountId],
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
    keepPreviousData: true,
  }))
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
    if (stored !== null) {
      return stored;
    }
    const calendars = get(googleCalendarsDataAtom);
    return calendars.map((calendar) => ({
      accountId: calendar.accountId,
      calendarId: calendar.calendar.id,
    }));
  }
);

// --- Events per calendar + window ---

export type GoogleEventWithSource = {
  event: GoogleEvent;
  accountId: string;
  calendarId: string;
};

export const visibleGoogleCalendarsAtom = atom<CalendarWithSource[]>((get) => {
  const calendars = get(googleCalendarsDataAtom);
  const isVisible = get(isCalendarVisibleAtom);
  return calendars.filter((calendar) =>
    isVisible(calendar.accountId, calendar.calendar.id)
  );
});

export const googleCalendarEventsForWindowAtom = atomFamily(
  (key: {
    accountId: string;
    calendarId: string;
    timeMin: string;
    timeMax: string;
  }) =>
    atomWithQuery<GoogleEventWithSource[]>(() => ({
      queryKey: [
        "google-events",
        key.accountId,
        key.calendarId,
        key.timeMin,
        key.timeMax,
      ],
      queryFn: async () =>
        orpc.googleCal.events.list
          .call({
            accountId: key.accountId,
            calendarId: key.calendarId,
            timeMin: key.timeMin,
            timeMax: key.timeMax,
          })
          .then((events) =>
            events.map((event) => ({
              event,
              accountId: key.accountId,
              calendarId: key.calendarId,
            }))
          ),
      staleTime: 5 * 60 * 1000,
      keepPreviousData: true,
    }))
);

export const allGoogleCalendarEventsForWindowAtom = atomFamily(
  (window: { timeMin: string; timeMax: string }) =>
    atom<GoogleEventWithSource[]>((get) => {
      const calendars: CalendarWithSource[] = get(visibleGoogleCalendarsAtom);
      const events: GoogleEventWithSource[] = [];
      for (const calendar of calendars) {
        const calendarEvents =
          get(
            googleCalendarEventsForWindowAtom({
              accountId: calendar.accountId,
              calendarId: calendar.calendar.id,
              timeMin: window.timeMin,
              timeMax: window.timeMax,
            })
          ).data ?? [];
        events.push(...calendarEvents);
      }

      return events;
    })
);
