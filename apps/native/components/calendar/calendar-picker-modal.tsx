import {
  isCalendarVisible,
  toggleCalendarSelection,
  type VisibleCalendars,
} from "@kompose/state/atoms/visible-calendars";
import type { CalendarWithSource } from "@kompose/state/hooks/use-google-calendars";
import type { Account } from "better-auth";
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

interface CalendarPickerModalProps {
  open: boolean;
  onClose: () => void;
  googleAccounts: Account[];
  googleCalendars: CalendarWithSource[];
  visibleCalendars: VisibleCalendars;
  setVisibleCalendars: (
    next: VisibleCalendars | ((prev: VisibleCalendars) => VisibleCalendars)
  ) => void;
  setVisibleCalendarsAll: () => void;
}

/**
 * Calendar visibility picker for mobile.
 *
 * Behavior:
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
  setVisibleCalendarsAll,
}: CalendarPickerModalProps) {
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

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={open}
    >
      <View className="flex-1 justify-end bg-black/35">
        <View className="max-h-[80%] rounded-t-2xl bg-background p-4">
          {/* Header */}
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="font-bold text-foreground text-lg">Calendars</Text>
            <Button onPress={onClose} size="sm" variant="ghost">
              <Text>Done</Text>
            </Button>
          </View>

          {/* Show all / Hide all actions */}
          <View className="mb-3 flex-row gap-2">
            <Button onPress={setVisibleCalendarsAll} variant="outline">
              <Text>Show all</Text>
            </Button>
            <Button onPress={() => setVisibleCalendars([])} variant="outline">
              <Text>Hide all</Text>
            </Button>
          </View>

          {/* Calendar list */}
          <ScrollView className="flex-1">
            {googleAccounts.length === 0 ? (
              <Text className="py-2 text-muted-foreground">
                No Google accounts linked.
              </Text>
            ) : (
              googleAccounts.map((account) => {
                const accountCalendars =
                  calendarsByAccount.get(account.id) ?? [];
                return (
                  <View className="mb-4" key={account.id}>
                    <Text className="mb-2 font-bold text-foreground">
                      Account
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
                            className="mb-2 flex-row items-center gap-2.5 border border-border px-3 py-2.5 active:bg-card"
                            key={`${account.id}-${calendar.id}`}
                            onPress={() =>
                              setVisibleCalendars((prev) => {
                                return toggleCalendarSelection(prev, {
                                  accountId: account.id,
                                  calendarId: calendar.id,
                                });
                              })
                            }
                          >
                            <View
                              className={`h-4 w-4 border border-border ${checked ? "bg-primary" : "bg-transparent"}`}
                            />
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
        </View>
      </View>
    </Modal>
  );
}
