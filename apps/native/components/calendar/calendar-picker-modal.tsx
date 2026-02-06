import { normalizedGoogleColorsAtomFamily } from "@kompose/state/atoms/google-colors";
import {
  isCalendarVisible,
  toggleCalendarSelection,
  type VisibleCalendars,
} from "@kompose/state/atoms/visible-calendars";
import type { CalendarWithSource } from "@kompose/state/hooks/use-google-calendars";
import { useGoogleAccountProfiles } from "@kompose/state/hooks/use-google-account-profiles";
import { useAtomValue } from "jotai";
import type { Account, OAuth2UserInfo } from "better-auth";
import { Check } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useColor } from "@/hooks/useColor";

interface CalendarPickerModalProps {
  open: boolean;
  onClose: () => void;
  googleAccounts: Account[];
  googleCalendars: CalendarWithSource[];
  visibleCalendars: VisibleCalendars;
  setVisibleCalendars: (
    next: VisibleCalendars | ((prev: VisibleCalendars) => VisibleCalendars)
  ) => void;
}

type CalendarId = {
  accountId: string;
  calendarId: string;
};

/**
 * Calendar visibility picker for mobile.
 *
 * Behavior:
 * - `visibleCalendars === null` => show all
 * - `visibleCalendars === []` => hide all
 * - else => show selected set
 */
export function CalendarPickerModal({
  open,
  onClose,
  googleAccounts,
  googleCalendars,
  visibleCalendars,
  setVisibleCalendars,
}: CalendarPickerModalProps) {
  const primaryColor = useColor("primary");
  const primaryForegroundColor = useColor("primaryForeground");
  const borderColor = useColor("border");
  const { profiles: googleAccountProfiles } = useGoogleAccountProfiles();

  const calendarsByAccount = useMemo(() => {
    const map = new Map<string, CalendarWithSource[]>();
    for (const account of googleAccounts) {
      map.set(account.id, []);
    }
    for (const cal of googleCalendars) {
      const bucket = map.get(cal.accountId);
      if (bucket) {
        bucket.push(cal);
      }
    }
    return map;
  }, [googleAccounts, googleCalendars]);

  const allCalendarIds = useMemo<CalendarId[]>(
    () =>
      googleCalendars.map((calendar) => ({
        accountId: calendar.accountId,
        calendarId: calendar.calendar.id,
      })),
    [googleCalendars]
  );

  const accountProfilesById = useMemo(() => {
    const map = new Map<
      string,
      { profile: OAuth2UserInfo | null; isLoading: boolean }
    >();
    for (const accountProfile of googleAccountProfiles) {
      map.set(accountProfile.account.id, {
        profile: accountProfile.profile,
        isLoading: accountProfile.isLoading,
      });
    }
    return map;
  }, [googleAccountProfiles]);

  return (
    <BottomSheet
      isVisible={open}
      onClose={onClose}
      snapPoints={[0.45, 0.75, 0.95]}
      title="Calendars"
    >
      {/* Show all / Hide all actions */}
      <View className="mb-3 flex-row gap-2">
        <Button onPress={() => setVisibleCalendars(null)} variant="outline">
          <Text>Show all</Text>
        </Button>
        <Button onPress={() => setVisibleCalendars([])} variant="outline">
          <Text>Hide all</Text>
        </Button>
      </View>

      {/* Calendar list */}
      <ScrollView style={{ maxHeight: 520 }}>
        {googleAccounts.length === 0 ? (
          <Text className="py-2 text-muted-foreground">
            No Google accounts linked.
          </Text>
        ) : (
          googleAccounts.map((account) => {
            const accountCalendars = calendarsByAccount.get(account.id) ?? [];
            const accountProfile = accountProfilesById.get(account.id);

            return (
              <CalendarAccountSection
                account={account}
                accountCalendars={accountCalendars}
                allCalendarIds={allCalendarIds}
                borderColor={borderColor}
                isProfileLoading={accountProfile?.isLoading ?? false}
                key={account.id}
                primaryColor={primaryColor}
                primaryForegroundColor={primaryForegroundColor}
                profile={accountProfile?.profile}
                setVisibleCalendars={setVisibleCalendars}
                visibleCalendars={visibleCalendars}
              />
            );
          })
        )}
      </ScrollView>
    </BottomSheet>
  );
}

interface CalendarAccountSectionProps {
  account: Account;
  accountCalendars: CalendarWithSource[];
  allCalendarIds: CalendarId[];
  visibleCalendars: VisibleCalendars;
  setVisibleCalendars: (
    next: VisibleCalendars | ((prev: VisibleCalendars) => VisibleCalendars)
  ) => void;
  primaryColor: string;
  primaryForegroundColor: string;
  borderColor: string;
  profile?: OAuth2UserInfo | null;
  isProfileLoading: boolean;
}

function CalendarAccountSection({
  account,
  accountCalendars,
  allCalendarIds,
  visibleCalendars,
  setVisibleCalendars,
  primaryColor,
  primaryForegroundColor,
  borderColor,
  profile,
  isProfileLoading,
}: CalendarAccountSectionProps) {
  const normalizedPalette = useAtomValue(
    normalizedGoogleColorsAtomFamily(account.id)
  );

  const accountTitle = isProfileLoading
    ? "Loading Google account..."
    : (profile?.email ?? profile?.name ?? account.accountId ?? "Google account");

  const accountSubtitle = isProfileLoading
    ? null
    : (profile?.name && profile.name !== profile.email
        ? profile.name
        : account.accountId);

  return (
    <View className="mb-4">
      <View className="mb-2 gap-0.5">
        <Text className="font-bold text-foreground" numberOfLines={1}>
          {accountTitle}
        </Text>
        {accountSubtitle ? (
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {accountSubtitle}
          </Text>
        ) : null}
      </View>
      {accountCalendars.length === 0 ? (
        <Text className="py-2 text-muted-foreground">
          No calendars found for this account.
        </Text>
      ) : (
        accountCalendars.map(({ calendar }) => {
          const checked = isCalendarVisible(
            visibleCalendars,
            account.id,
            calendar.id
          );
          const paletteColor =
            calendar.colorId && normalizedPalette?.calendar
              ? normalizedPalette.calendar[calendar.colorId]
              : undefined;
          const calendarColor =
            calendar.backgroundColor ?? paletteColor?.background ?? undefined;

          return (
            <Pressable
              className="mb-2 flex-row items-center gap-2.5 rounded-md border border-border px-3 py-2.5 active:bg-card"
              key={`${account.id}-${calendar.id}`}
              onPress={() =>
                setVisibleCalendars((prev) => {
                  const base = prev ?? allCalendarIds;
                  return toggleCalendarSelection(base, {
                    accountId: account.id,
                    calendarId: calendar.id,
                  });
                })
              }
            >
              <View
                className="h-5 w-5 items-center justify-center rounded border"
                style={{
                  borderColor: checked ? primaryColor : borderColor,
                  backgroundColor: checked ? primaryColor : "transparent",
                }}
              >
                {checked ? (
                  <Check
                    color={primaryForegroundColor}
                    size={14}
                    strokeWidth={2.5}
                  />
                ) : null}
              </View>
              <View
                className="h-2.5 w-2.5 rounded-full border"
                style={{
                  borderColor: calendarColor ?? borderColor,
                  backgroundColor: calendarColor ?? "transparent",
                }}
              />
              <Text
                className="flex-1 font-semibold text-foreground"
                numberOfLines={1}
                style={calendarColor ? { color: calendarColor } : undefined}
              >
                {calendar.summary ?? "Calendar"}
              </Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}
