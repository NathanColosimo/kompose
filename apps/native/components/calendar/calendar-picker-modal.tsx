import {
  isCalendarVisible,
  toggleCalendarSelection,
  type VisibleCalendars,
} from "@kompose/state/atoms/visible-calendars";
import type { CalendarWithSource } from "@kompose/state/hooks/use-google-calendars";
import type { Account } from "better-auth";
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

  const allCalendarIds = useMemo(
    () =>
      googleCalendars.map((calendar) => ({
        accountId: calendar.accountId,
        calendarId: calendar.calendar.id,
      })),
    [googleCalendars]
  );

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
            return (
              <View className="mb-4" key={account.id}>
                <Text className="mb-2 font-bold text-foreground">
                  {account.accountId || "Account"}
                </Text>
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
                            backgroundColor: checked
                              ? primaryColor
                              : "transparent",
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
                        <Text
                          className="flex-1 font-semibold text-foreground"
                          numberOfLines={1}
                        >
                          {calendar.summary ?? "Calendar"}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </BottomSheet>
  );
}
