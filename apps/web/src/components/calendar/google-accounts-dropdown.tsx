"use client";

import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@kompose/state/atoms/google-colors";
import {
  type CalendarWithSource,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import {
  type CalendarIdentifier,
  isCalendarVisible,
  toggleCalendarSelection,
  visibleCalendarsAtom,
} from "@kompose/state/atoms/visible-calendars";
import { useGoogleAccountProfiles } from "@kompose/state/hooks/use-google-account-profiles";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface GoogleAccount {
  accountId: string;
  id: string;
  providerId: string;
}

type AccountWithInfo = GoogleAccount & {
  email?: string;
  name?: string;
  isLoading?: boolean;
};

interface GoogleAccountsDropdownProps {
  googleAccounts: GoogleAccount[];
  googleCalendars: CalendarWithSource[];
}

export function GoogleAccountsDropdown({
  googleAccounts,
  googleCalendars,
}: GoogleAccountsDropdownProps) {
  const setVisibleCalendars = useSetAtom(visibleCalendarsAtom);
  const resolvedVisibleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);

  const allCalendarIds = useMemo<CalendarIdentifier[]>(
    () =>
      googleCalendars.map((calendar) => ({
        accountId: calendar.accountId,
        calendarId: calendar.calendar.id,
      })),
    [googleCalendars]
  );

  const { profiles: googleAccountProfiles } = useGoogleAccountProfiles();
  const accountProfilesById = useMemo(
    () =>
      new Map(
        googleAccountProfiles.map((profile) => [
          profile.account.accountId,
          profile,
        ])
      ),
    [googleAccountProfiles]
  );

  // Merge account info with accounts
  const accountsWithInfo: AccountWithInfo[] = useMemo(
    () =>
      googleAccounts.map((account) => {
        const query = accountProfilesById.get(account.accountId);
        return {
          ...account,
          email: query?.profile?.email ?? undefined,
          name: query?.profile?.name,
          isLoading: query?.isLoading,
        };
      }),
    [accountProfilesById, googleAccounts]
  );

  // Group calendars by account
  const calendarsByAccount = useMemo(() => {
    const grouped = new Map<string, CalendarWithSource[]>();
    for (const account of googleAccounts) {
      grouped.set(account.accountId, []);
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
        toggleCalendarSelection(prev ?? allCalendarIds, {
          accountId,
          calendarId,
        })
      );
    },
    [allCalendarIds, setVisibleCalendars]
  );

  const isResolvedCalendarVisible = useCallback(
    (accountId: string, calendarId: string) =>
      isCalendarVisible(resolvedVisibleCalendars, accountId, calendarId),
    [resolvedVisibleCalendars]
  );

  // Count of visible calendars
  const visibleCount = resolvedVisibleCalendars.length;

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
            calendars={calendarsByAccount.get(account.accountId) ?? []}
            isCalendarVisible={isResolvedCalendarVisible}
            isLastAccount={accountIndex === accountsWithInfo.length - 1}
            key={account.accountId}
            toggleCalendar={toggleCalendar}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AccountCalendarsSectionProps {
  account: AccountWithInfo;
  calendars: CalendarWithSource[];
  isCalendarVisible: (accountId: string, calendarId: string) => boolean;
  isLastAccount: boolean;
  toggleCalendar: (accountId: string, calendarId: string) => void;
}

function AccountCalendarsSection({
  account,
  calendars,
  isCalendarVisible,
  toggleCalendar,
  isLastAccount,
}: AccountCalendarsSectionProps) {
  const normalizedPalette = useAtomValue(
    normalizedGoogleColorsAtomFamily(account.accountId)
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
            checked={isCalendarVisible(account.accountId, calendar.calendar.id)}
            className="cursor-pointer"
            key={`${account.accountId}-${calendar.calendar.id}`}
            onCheckedChange={() =>
              toggleCalendar(account.accountId, calendar.calendar.id)
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
      account.accountId,
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
