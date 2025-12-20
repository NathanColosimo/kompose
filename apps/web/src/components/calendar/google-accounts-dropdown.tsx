"use client";

import { useQueries } from "@tanstack/react-query";
import type { OAuth2UserInfo } from "better-auth";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@/atoms/google-colors";
import type { CalendarWithSource } from "@/atoms/google-data";
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

type AccountWithInfo = GoogleAccount & {
  email?: string;
  name?: string;
  isLoading?: boolean;
};

type GoogleAccountsDropdownProps = {
  googleAccounts: GoogleAccount[];
  googleCalendars: CalendarWithSource[];
};

function matchesCalendar(
  target: CalendarIdentifier,
  accountId: string,
  calendarId: string
) {
  return target.accountId === accountId && target.calendarId === calendarId;
}

function toggleCalendarSelection(
  prev: CalendarIdentifier[],
  target: CalendarIdentifier
): CalendarIdentifier[] {
  if (prev.length === 0) {
    return [target];
  }

  const exists = prev.some((c) =>
    matchesCalendar(c, target.accountId, target.calendarId)
  );
  const next = exists
    ? prev.filter(
        (c) => !matchesCalendar(c, target.accountId, target.calendarId)
      )
    : [...prev, target];

  return next;
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
    const grouped = new Map<string, CalendarWithSource[]>();
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
        toggleCalendarSelection(prev ?? [], { accountId, calendarId })
      );
    },
    [setVisibleCalendars]
  );

  // Count of visible calendars
  const visibleCount = useMemo(() => {
    if (visibleCalendars === null) {
      return googleCalendars.length;
    }
    return visibleCalendars.length;
  }, [googleCalendars.length, visibleCalendars]);

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
        <Button className="gap-2" size="lg" variant="outline">
          <span className="text-sm">
            Calendars ({visibleCount}/{totalCount})
          </span>
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {accountsWithInfo.map((account, accountIndex) => (
          <AccountCalendarsSection
            account={account}
            calendars={calendarsByAccount.get(account.id) ?? []}
            isCalendarVisible={isCalendarVisible}
            isLastAccount={accountIndex === accountsWithInfo.length - 1}
            key={account.id}
            toggleCalendar={toggleCalendar}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type AccountCalendarsSectionProps = {
  account: AccountWithInfo;
  calendars: CalendarWithSource[];
  isCalendarVisible: (accountId: string, calendarId: string) => boolean;
  toggleCalendar: (accountId: string, calendarId: string) => void;
  isLastAccount: boolean;
};

function AccountCalendarsSection({
  account,
  calendars,
  isCalendarVisible,
  toggleCalendar,
  isLastAccount,
}: AccountCalendarsSectionProps) {
  const normalizedPalette = useAtomValue(
    normalizedGoogleColorsAtomFamily(account.id)
  );

  const calendarItems = useMemo(
    () =>
      calendars.map((calendar) => {
        const backgroundColor = calendar.calendar.backgroundColor
          ? pastelizeColor(calendar.calendar.backgroundColor)
          : normalizedPalette?.calendar?.[calendar?.calendar.colorId ?? ""]
              ?.background;
        const swatchStyle = backgroundColor
          ? {
              backgroundColor,
              borderColor: backgroundColor,
            }
          : undefined;

        return (
          <DropdownMenuCheckboxItem
            checked={isCalendarVisible(account.id, calendar.calendar.id)}
            className="cursor-pointer"
            key={`${account.id}-${calendar.calendar.id}`}
            onCheckedChange={() =>
              toggleCalendar(account.id, calendar.calendar.id)
            }
            onSelect={(event) => event.preventDefault()}
          >
            <span
              className="mr-2 inline-block h-3 w-3 rounded-sm border"
              style={swatchStyle}
            />
            <span className="truncate">{calendar.calendar.summary}</span>
          </DropdownMenuCheckboxItem>
        );
      }),
    [
      account.id,
      calendars,
      isCalendarVisible,
      toggleCalendar,
      normalizedPalette,
    ]
  );

  return (
    <div>
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
        {calendarItems}
        {calendars.length === 0 && (
          <span className="px-2 py-1.5 text-muted-foreground text-xs">
            No calendars found
          </span>
        )}
      </div>

      {!isLastAccount && <DropdownMenuSeparator />}
    </div>
  );
}
