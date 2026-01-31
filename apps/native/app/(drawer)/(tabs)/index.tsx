import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import React from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Temporal } from "temporal-polyfill";
import { Container } from "@/components/container";
import { useTasks } from "@/hooks/use-tasks";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";

function getSystemTimeZone(): string {
  // RN supports Intl in modern Expo builds. Fallback is UTC.
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

function formatPlainDate(date: Temporal.PlainDate): string {
  // Minimal formatting for v1 (e.g. 2026-01-31).
  return date.toString();
}

function formatPlainTime(time: Temporal.PlainTime): string {
  // Minimal formatting for v1 (e.g. 09:30).
  return time.toString({ smallestUnit: "minute" });
}

function dateToPlainDate(date: Date, timeZone: string): Temporal.PlainDate {
  const zdt = Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(
    timeZone
  );
  return zdt.toPlainDate();
}

function dateToPlainTime(date: Date, timeZone: string): Temporal.PlainTime {
  const zdt = Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(
    timeZone
  );
  return Temporal.PlainTime.from({
    hour: zdt.hour,
    minute: zdt.minute,
    second: 0,
  });
}

interface TaskDraft {
  title: string;
  description: string;
  durationMinutes: number;
  dueDate: Temporal.PlainDate | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
}

function buildDraftFromTask(task: TaskSelectDecoded): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    durationMinutes: task.durationMinutes,
    dueDate: task.dueDate,
    startDate: task.startDate,
    startTime: task.startTime,
  };
}

function buildEmptyDraft(): TaskDraft {
  return {
    title: "",
    description: "",
    durationMinutes: 30,
    dueDate: null,
    startDate: null,
    startTime: null,
  };
}

export default function TasksTab() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const timeZone = getSystemTimeZone();

  const { tasksQuery, createTask, updateTask, deleteTask } = useTasks();
  const tasks = tasksQuery.data ?? [];

  // Inbox-like list: non-done tasks that are not scheduled (no startDate/time).
  const inboxTasks = tasks
    .filter((t) => t.status !== "done")
    .filter((t) => t.startDate === null && t.startTime === null)
    .filter((t) => t.seriesMasterId === null) // keep v1 simple (no recurrence UX)
    .sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

  // Modal state (create/edit).
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingTask, setEditingTask] =
    React.useState<TaskSelectDecoded | null>(null);
  const [draft, setDraft] = React.useState<TaskDraft>(buildEmptyDraft);

  // Date/time picker state (native picker).
  const [picker, setPicker] = React.useState<
    | { kind: "due"; mode: "date" }
    | { kind: "startDate"; mode: "date" }
    | { kind: "startTime"; mode: "time" }
    | null
  >(null);

  function openCreate() {
    setEditingTask(null);
    setDraft(buildEmptyDraft());
    setIsModalOpen(true);
  }

  function openEdit(task: TaskSelectDecoded) {
    setEditingTask(task);
    setDraft(buildDraftFromTask(task));
    setIsModalOpen(true);
  }

  function closeModal() {
    setPicker(null);
    setIsModalOpen(false);
  }

  function handleSave() {
    if (!draft.title.trim()) {
      return;
    }

    if (editingTask) {
      updateTask.mutate({
        id: editingTask.id,
        scope: "this",
        task: {
          title: draft.title.trim(),
          description: draft.description.trim()
            ? draft.description.trim()
            : null,
          durationMinutes: draft.durationMinutes,
          dueDate: draft.dueDate,
          startDate: draft.startDate,
          startTime: draft.startTime,
        },
      });
    } else {
      createTask.mutate({
        title: draft.title.trim(),
        description: draft.description.trim() ? draft.description.trim() : null,
        durationMinutes: draft.durationMinutes,
        dueDate: draft.dueDate,
        startDate: draft.startDate,
        startTime: draft.startTime,
        status: "todo",
        recurrence: null,
        seriesMasterId: null,
        isException: false,
      });
    }

    closeModal();
  }

  function handleDelete() {
    if (!editingTask) {
      return;
    }
    deleteTask.mutate({ id: editingTask.id, scope: "this" });
    closeModal();
  }

  function handleToggleDone() {
    if (!editingTask) {
      return;
    }
    updateTask.mutate({
      id: editingTask.id,
      scope: "this",
      task: { status: editingTask.status === "done" ? "todo" : "done" },
    });
    closeModal();
  }

  return (
    <Container>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Tasks</Text>
        <TouchableOpacity
          onPress={openCreate}
          style={[styles.addButton, { backgroundColor: theme.primary }]}
        >
          <Text style={styles.addButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={inboxTasks}
        keyExtractor={(t) => t.id}
        ListEmptyComponent={
          tasksQuery.isLoading ? (
            <Text
              style={[styles.emptyText, { color: theme.text, opacity: 0.7 }]}
            >
              Loading…
            </Text>
          ) : (
            <Text
              style={[styles.emptyText, { color: theme.text, opacity: 0.7 }]}
            >
              No tasks in inbox.
            </Text>
          )
        }
        refreshControl={
          <RefreshControl
            onRefresh={() => tasksQuery.refetch()}
            refreshing={tasksQuery.isFetching}
            tintColor={theme.text}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openEdit(item)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? theme.card : "transparent",
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.rowTop}>
              <Text
                numberOfLines={1}
                style={[styles.rowTitle, { color: theme.text }]}
              >
                {item.title}
              </Text>
              <Text
                style={[styles.rowMeta, { color: theme.text, opacity: 0.7 }]}
              >
                {item.durationMinutes}m
              </Text>
            </View>
            {item.dueDate ? (
              <Text
                style={[styles.rowSub, { color: theme.text, opacity: 0.7 }]}
              >
                Due {formatPlainDate(item.dueDate)}
              </Text>
            ) : null}
          </Pressable>
        )}
      />

      <Modal
        animationType="slide"
        onRequestClose={closeModal}
        transparent
        visible={isModalOpen}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[styles.modalCard, { backgroundColor: theme.background }]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                {editingTask ? "Edit task" : "New task"}
              </Text>
              <TouchableOpacity onPress={closeModal}>
                <Text style={[styles.modalClose, { color: theme.text }]}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              onChangeText={(value) =>
                setDraft((d) => ({ ...d, title: value }))
              }
              placeholder="Title"
              placeholderTextColor={theme.text}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border },
              ]}
              value={draft.title}
            />

            <TextInput
              multiline
              onChangeText={(value) =>
                setDraft((d) => ({ ...d, description: value }))
              }
              placeholder="Description (optional)"
              placeholderTextColor={theme.text}
              style={[
                styles.textArea,
                { color: theme.text, borderColor: theme.border },
              ]}
              value={draft.description}
            />

            <View style={styles.rowGroup}>
              <Text style={[styles.label, { color: theme.text }]}>
                Duration
              </Text>
              <TextInput
                keyboardType="number-pad"
                onChangeText={(value) => {
                  const parsed = Number.parseInt(value, 10);
                  setDraft((d) => ({
                    ...d,
                    durationMinutes: Number.isFinite(parsed) ? parsed : 30,
                  }));
                }}
                placeholder="30"
                placeholderTextColor={theme.text}
                style={[
                  styles.smallInput,
                  { color: theme.text, borderColor: theme.border },
                ]}
                value={String(draft.durationMinutes)}
              />
              <Text
                style={[styles.mSuffix, { color: theme.text, opacity: 0.7 }]}
              >
                min
              </Text>
            </View>

            <View style={styles.buttonsRow}>
              <TouchableOpacity
                onPress={() => setPicker({ kind: "due", mode: "date" })}
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  {draft.dueDate
                    ? `Due: ${formatPlainDate(draft.dueDate)}`
                    : "Set due date"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setDraft((d) => ({ ...d, dueDate: null }))}
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  Clear due
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.buttonsRow}>
              <TouchableOpacity
                onPress={() => setPicker({ kind: "startDate", mode: "date" })}
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  {draft.startDate
                    ? `Start: ${formatPlainDate(draft.startDate)}`
                    : "Set start date"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() =>
                  setDraft((d) => ({ ...d, startDate: null, startTime: null }))
                }
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  Clear start
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.buttonsRow}>
              <TouchableOpacity
                disabled={!draft.startDate}
                onPress={() => setPicker({ kind: "startTime", mode: "time" })}
                style={[
                  styles.secondaryButton,
                  {
                    borderColor: theme.border,
                    opacity: draft.startDate ? 1 : 0.5,
                  },
                ]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  {draft.startTime
                    ? `Time: ${formatPlainTime(draft.startTime)}`
                    : "Set start time"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setDraft((d) => ({ ...d, startTime: null }))}
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  Clear time
                </Text>
              </TouchableOpacity>
            </View>

            {picker ? (
              <DateTimePicker
                mode={picker.mode}
                onChange={(event: DateTimePickerEvent, date?: Date) => {
                  // Android fires an event when dismissed.
                  if (event.type === "dismissed") {
                    setPicker(null);
                    return;
                  }
                  if (!date) {
                    setPicker(null);
                    return;
                  }

                  if (picker.kind === "due") {
                    setDraft((d) => ({
                      ...d,
                      dueDate: dateToPlainDate(date, timeZone),
                    }));
                  }
                  if (picker.kind === "startDate") {
                    setDraft((d) => ({
                      ...d,
                      startDate: dateToPlainDate(date, timeZone),
                    }));
                  }
                  if (picker.kind === "startTime") {
                    setDraft((d) => ({
                      ...d,
                      startTime: dateToPlainTime(date, timeZone),
                    }));
                  }

                  setPicker(null);
                }}
                value={new Date()}
              />
            ) : null}

            <View style={styles.modalFooter}>
              {editingTask ? (
                <TouchableOpacity
                  onPress={handleToggleDone}
                  style={[
                    styles.secondaryButton,
                    { borderColor: theme.border },
                  ]}
                >
                  <Text
                    style={[styles.secondaryButtonText, { color: theme.text }]}
                  >
                    {editingTask.status === "done" ? "Mark todo" : "Mark done"}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {editingTask ? (
                <TouchableOpacity
                  onPress={handleDelete}
                  style={[
                    styles.dangerButton,
                    { borderColor: theme.notification },
                  ]}
                >
                  <Text
                    style={[
                      styles.dangerButtonText,
                      { color: theme.notification },
                    ]}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={handleSave}
                style={[
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                ]}
              >
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Container>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
  addButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  rowMeta: {
    fontSize: 12,
  },
  rowSub: {
    fontSize: 12,
    marginTop: 4,
  },
  emptyText: {
    paddingTop: 32,
    textAlign: "center",
  },

  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalCard: {
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  modalClose: {
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  textArea: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    fontSize: 14,
    minHeight: 88,
  },
  rowGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  smallInput: {
    borderWidth: 1,
    padding: 10,
    width: 80,
    fontSize: 16,
  },
  mSuffix: {
    fontSize: 14,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  modalFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  dangerButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  dangerButtonText: {
    fontWeight: "700",
  },
  primaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
