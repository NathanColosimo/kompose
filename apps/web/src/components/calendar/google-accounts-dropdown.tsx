"use client";

import type { Calendar } from "@kompose/google-cal/schema";
import { useQueries } from "@tanstack/react-query";
import type { OAuth2UserInfo } from "better-auth";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  type CalendarIdentifier,
  isCalendarVisibleAtom,
  visibleCalendarsAtom,
} from "@/atoms/visible-calendars";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

type GoogleAccount = {
  id: string;
  accountId: string;
  providerId: string;
};

type CalendarWithAccount = Calendar & {
  accountId: string;
};

type AccountWithInfo = GoogleAccount & {
  email?: string;
  name?: string;
  isLoading?: boolean;
};

type GoogleAccountsDropdownProps = {
  googleAccounts: GoogleAccount[];
  googleCalendars: CalendarWithAccount[];
};

function matchesCalendar(
  target: CalendarIdentifier,
  accountId: string,
  calendarId: string
) {
  return target.accountId === accountId && target.calendarId === calendarId;
}

function toCalendarIdentifier(
  calendar: CalendarWithAccount
): CalendarIdentifier {
  return { accountId: calendar.accountId, calendarId: calendar.id };
}

// Preserve "empty array => all calendars visible" while toggling a single calendar
function toggleCalendarSelection(
  prev: CalendarIdentifier[],
  target: CalendarIdentifier,
  allCalendars: CalendarWithAccount[]
): CalendarIdentifier[] {
  if (prev.length === 0) {
    const next = allCalendars
      .filter(
        (calendar) => !matchesCalendar(target, calendar.accountId, calendar.id)
      )
      .map(toCalendarIdentifier);
    return next.length === allCalendars.length ? [] : next;
  }

  const exists = prev.some((c) =>
    matchesCalendar(c, target.accountId, target.calendarId)
  );
  const next = exists
    ? prev.filter(
        (c) => !matchesCalendar(c, target.accountId, target.calendarId)
      )
    : [...prev, target];

  return next.length === allCalendars.length ? [] : next;
}

export function GoogleAccountsDropdown({
  googleAccounts,
  googleCalendars,
}: GoogleAccountsDropdownProps) {
  const [visibleCalendars, setVisibleCalendars] = useAtom(visibleCalendarsAtom);
  const isCalendarVisible = useAtomValue(isCalendarVisibleAtom);

  // Fetch account info for each Google account to get their email
  const accountInfoQueries = useQueries({
    queries: googleAccounts.map((account) => ({
      queryKey: ["google-account-info", account.accountId],
      queryFn: async (): Promise<OAuth2UserInfo | null> => {
        try {
          const result = await authClient.accountInfo({
            query: { accountId: account.accountId },
          });
          return result?.data?.user ?? null;
        } catch {
          return null;
        }
      },
    })),
  });

  // Merge account info with accounts
  const accountsWithInfo: AccountWithInfo[] = useMemo(
    () =>
      googleAccounts.map((account, index) => {
        const query = accountInfoQueries[index];
        return {
          ...account,
          email: query?.data?.email ?? undefined,
          name: query?.data?.name,
          isLoading: query?.isLoading,
        };
      }),
    [googleAccounts, accountInfoQueries]
  );

  // Group calendars by account
  const calendarsByAccount = useMemo(() => {
    const grouped = new Map<string, CalendarWithAccount[]>();
    for (const account of googleAccounts) {
      grouped.set(account.id, []);
    }
    for (const calendar of googleCalendars) {
      const accountCalendars = grouped.get(calendar.accountId);
      if (accountCalendars) {
        accountCalendars.push(calendar);
      }
    }
    return grouped;
  }, [googleAccounts, googleCalendars]);

  // Toggle a calendar's visibility
  const toggleCalendar = useCallback(
    (accountId: string, calendarId: string) => {
      setVisibleCalendars((prev) =>
        toggleCalendarSelection(
          prev,
          { accountId, calendarId },
          googleCalendars
        )
      );
    },
    [setVisibleCalendars, googleCalendars]
  );

  // Count of visible calendars
  const visibleCount = useMemo(() => {
    if (visibleCalendars.length === 0) {
      return googleCalendars.length;
    }
    return visibleCalendars.length;
  }, [visibleCalendars, googleCalendars]);

  const totalCount = googleCalendars.length;

  if (googleAccounts.length === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        No Google accounts linked
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-2" size="sm" variant="outline">
          <span className="text-sm">
            Calendars ({visibleCount}/{totalCount})
          </span>
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {accountsWithInfo.map((account, accountIndex) => {
          const accountCalendars = calendarsByAccount.get(account.id) ?? [];
          const isLastAccount = accountIndex === accountsWithInfo.length - 1;

          return (
            <div key={account.id}>
              <div className="flex items-center px-2 py-1.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium text-sm">
                    {account.isLoading ? (
                      <RefreshCw className="inline size-3 animate-spin" />
                    ) : (
                      (account.email ?? account.name ?? "Google Account")
                    )}
                  </span>
                </div>
              </div>

              {/* Individual calendars for this account */}
              <div className="ml-3 border-l pl-2">
                {accountCalendars.map((calendar) => (
                  <DropdownMenuCheckboxItem
                    checked={isCalendarVisible(account.id, calendar.id)}
                    className="cursor-pointer"
                    key={`${account.id}-${calendar.id}`}
                    onCheckedChange={() =>
                      toggleCalendar(account.id, calendar.id)
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="truncate">{calendar.summary}</span>
                  </DropdownMenuCheckboxItem>
                ))}
                {accountCalendars.length === 0 && (
                  <span className="px-2 py-1.5 text-muted-foreground text-xs">
                    No calendars found
                  </span>
                )}
              </div>

              {!isLastAccount && <DropdownMenuSeparator />}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
