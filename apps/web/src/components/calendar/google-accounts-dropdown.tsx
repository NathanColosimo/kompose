"use client";

import type { Calendar } from "@kompose/google-cal/schema";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  type CalendarIdentifier,
  visibleCalendarsAtom,
} from "@/atoms/visible-calendars";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

type GoogleAccount = {
  id: string;
  accountId: string;
  providerId: string;
};

type GoogleAccountInfo = {
  email: string;
  name?: string;
  picture?: string;
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

export function GoogleAccountsDropdown({
  googleAccounts,
  googleCalendars,
}: GoogleAccountsDropdownProps) {
  const [visibleCalendars, setVisibleCalendars] = useAtom(visibleCalendarsAtom);

  // Fetch account info for each Google account to get their email
  const accountInfoQueries = useQueries({
    queries: googleAccounts.map((account) => ({
      queryKey: ["google-account-info", account.id],
      queryFn: async (): Promise<GoogleAccountInfo | null> => {
        try {
          const result = await authClient.accountInfo({
            query: { accountId: account.id },
          });
          if (result?.data) {
            // The response contains user info from OAuth2
            const userInfo = result.data.user;
            return {
              email: userInfo?.email ?? "",
              name: userInfo?.name,
              picture: userInfo?.image,
            };
          }
          return null;
        } catch {
          return null;
        }
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
    })),
  });

  // Merge account info with accounts
  const accountsWithInfo: AccountWithInfo[] = useMemo(() => {
    return googleAccounts.map((account, index) => {
      const query = accountInfoQueries[index];
      return {
        ...account,
        email: query?.data?.email,
        name: query?.data?.name,
        isLoading: query?.isLoading,
      };
    });
  }, [googleAccounts, accountInfoQueries]);

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

  // Check if a calendar is currently visible
  const isCalendarVisible = useCallback(
    (accountId: string, calendarId: string) => {
      // If no calendars are explicitly selected, all are visible
      if (visibleCalendars.length === 0) {
        return true;
      }
      return visibleCalendars.some(
        (c) => c.accountId === accountId && c.calendarId === calendarId
      );
    },
    [visibleCalendars]
  );

  // Toggle a calendar's visibility
  const toggleCalendar = useCallback(
    (accountId: string, calendarId: string) => {
      setVisibleCalendars((prev) => {
        // If previously empty (all visible), initialize with all calendars except the toggled one
        if (prev.length === 0) {
          const allCalendars: CalendarIdentifier[] = [];
          for (const calendar of googleCalendars) {
            if (
              !(
                calendar.accountId === accountId && calendar.id === calendarId
              )
            ) {
              allCalendars.push({
                accountId: calendar.accountId,
                calendarId: calendar.id,
              });
            }
          }
          return allCalendars;
        }

        // Check if calendar is already in the list
        const existingIndex = prev.findIndex(
          (c) => c.accountId === accountId && c.calendarId === calendarId
        );

        if (existingIndex >= 0) {
          // Remove it (hide the calendar)
          return prev.filter((_, i) => i !== existingIndex);
        }
        // Add it (show the calendar)
        return [...prev, { accountId, calendarId }];
      });
    },
    [setVisibleCalendars, googleCalendars]
  );

  // Check if all calendars for an account are visible
  const isAccountFullyVisible = useCallback(
    (accountId: string) => {
      const accountCalendars = calendarsByAccount.get(accountId) ?? [];
      if (accountCalendars.length === 0) return false;
      return accountCalendars.every((cal) =>
        isCalendarVisible(accountId, cal.id)
      );
    },
    [calendarsByAccount, isCalendarVisible]
  );

  // Check if any calendars for an account are visible
  const isAccountPartiallyVisible = useCallback(
    (accountId: string) => {
      const accountCalendars = calendarsByAccount.get(accountId) ?? [];
      if (accountCalendars.length === 0) return false;
      const visibleCount = accountCalendars.filter((cal) =>
        isCalendarVisible(accountId, cal.id)
      ).length;
      return visibleCount > 0 && visibleCount < accountCalendars.length;
    },
    [calendarsByAccount, isCalendarVisible]
  );

  // Toggle all calendars for an account
  const toggleAccount = useCallback(
    (accountId: string) => {
      const accountCalendars = calendarsByAccount.get(accountId) ?? [];
      const isFullyVisible = isAccountFullyVisible(accountId);

      setVisibleCalendars((prev) => {
        // If previously empty (all visible), we need to initialize the list
        if (prev.length === 0) {
          if (isFullyVisible) {
            // Hiding this account: add all calendars except this account's
            const allCalendars: CalendarIdentifier[] = [];
            for (const calendar of googleCalendars) {
              if (calendar.accountId !== accountId) {
                allCalendars.push({
                  accountId: calendar.accountId,
                  calendarId: calendar.id,
                });
              }
            }
            return allCalendars;
          }
          // This shouldn't happen when prev is empty, but handle it
          return prev;
        }

        if (isFullyVisible) {
          // Hide all calendars for this account
          return prev.filter((c) => c.accountId !== accountId);
        }
        // Show all calendars for this account
        const newCalendars = accountCalendars
          .filter((cal) => !isCalendarVisible(accountId, cal.id))
          .map((cal) => ({ accountId, calendarId: cal.id }));
        return [...prev, ...newCalendars];
      });
    },
    [
      calendarsByAccount,
      isAccountFullyVisible,
      setVisibleCalendars,
      googleCalendars,
      isCalendarVisible,
    ]
  );

  // Show all calendars
  const showAllCalendars = useCallback(() => {
    setVisibleCalendars([]);
  }, [setVisibleCalendars]);

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
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Google Calendars</DropdownMenuLabel>
          {visibleCalendars.length > 0 && (
            <Button
              className="h-auto p-0 text-xs"
              onClick={showAllCalendars}
              variant="link"
            >
              Show all
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />

        {accountsWithInfo.map((account) => {
          const accountCalendars = calendarsByAccount.get(account.id) ?? [];
          const isFullyVisible = isAccountFullyVisible(account.id);
          const isPartiallyVisible = isAccountPartiallyVisible(account.id);

          return (
            <div key={account.id}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Checkbox
                  checked={isFullyVisible ? true : isPartiallyVisible ? "indeterminate" : false}
                  onCheckedChange={() => toggleAccount(account.id)}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-sm">
                    {account.isLoading ? (
                      <RefreshCw className="inline size-3 animate-spin" />
                    ) : (
                      account.email ?? account.name ?? "Google Account"
                    )}
                  </span>
                  {account.name && account.email && (
                    <span className="truncate text-muted-foreground text-xs">
                      {account.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Individual calendars for this account */}
              <div className="ml-6 border-l pl-2">
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

              {accountsWithInfo.indexOf(account) <
                accountsWithInfo.length - 1 && <DropdownMenuSeparator />}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
