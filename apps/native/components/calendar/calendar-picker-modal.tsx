import type { Account } from "better-auth";
import { useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { CalendarWithSource } from "@/hooks/use-google-calendars";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";
import {
  isCalendarVisible,
  toggleCalendarSelection,
  type VisibleCalendars,
} from "@/lib/visible-calendars";

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
 * Simple calendar visibility picker for mobile.
 *
 * Mirrors the web behavior:
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
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;

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
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Calendars</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.closeText, { color: theme.text }]}>
                Done
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              onPress={() => setVisibleCalendars(null)}
              style={[styles.actionButton, { borderColor: theme.border }]}
            >
              <Text style={[styles.actionText, { color: theme.text }]}>
                Show all
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setVisibleCalendars([])}
              style={[styles.actionButton, { borderColor: theme.border }]}
            >
              <Text style={[styles.actionText, { color: theme.text }]}>
                Hide all
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll}>
            {googleAccounts.length === 0 ? (
              <Text
                style={[styles.emptyText, { color: theme.text, opacity: 0.7 }]}
              >
                No Google accounts linked.
              </Text>
            ) : (
              googleAccounts.map((account) => {
                const accountCalendars =
                  calendarsByAccount.get(account.id) ?? [];
                return (
                  <View key={account.id} style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: theme.text }]}>
                      Account
                    </Text>
                    {accountCalendars.length === 0 ? (
                      <Text
                        style={[
                          styles.emptyText,
                          { color: theme.text, opacity: 0.7 },
                        ]}
                      >
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
                            key={`${account.id}-${calendar.id}`}
                            onPress={() =>
                              setVisibleCalendars((prev) => {
                                // Switching away from `null` means user is now explicitly choosing.
                                const base = prev ?? [];
                                return toggleCalendarSelection(base, {
                                  accountId: account.id,
                                  calendarId: calendar.id,
                                });
                              })
                            }
                            style={({ pressed }) => [
                              styles.calendarRow,
                              {
                                borderColor: theme.border,
                                backgroundColor: pressed
                                  ? theme.card
                                  : "transparent",
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.checkbox,
                                {
                                  borderColor: theme.border,
                                  backgroundColor: checked
                                    ? theme.primary
                                    : "transparent",
                                },
                              ]}
                            />
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.calendarName,
                                { color: theme.text },
                              ]}
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  card: {
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeText: {
    fontSize: 14,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  actionButton: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  actionText: {
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontWeight: "700",
    marginBottom: 8,
  },
  calendarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  checkbox: {
    height: 16,
    width: 16,
    borderWidth: 1,
  },
  calendarName: {
    flex: 1,
    fontWeight: "600",
  },
  emptyText: {
    paddingVertical: 8,
  },
});
