import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { useNavigation } from "@react-navigation/native";
import { Plus, Undo2, X } from "lucide-react-native";
import React from "react";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { Temporal } from "temporal-polyfill";
import { Container } from "@/components/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { useColorScheme } from "@/lib/color-scheme-context";
import { cn } from "@/lib/utils";

function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

function formatPlainDateShort(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(plainDateToDate(date));
}

function formatPlainDateLong(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(plainDateToDate(date));
}

function formatPlainTime(time: Temporal.PlainTime): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(plainTimeToDate(time));
}

// Format minutes into a compact label for the duration picker.
function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (remainder === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}

// Delay before finalizing a task as done (allows undo).
const UNDO_DELAY_MS = 5000;

// Convert a plain date into a JS Date using the device's local timezone.
function plainDateToDate(plainDate: Temporal.PlainDate): Date {
  return new Date(`${plainDate.toString()}T00:00:00`);
}

// Convert a plain time into a JS Date using today's date.
function plainTimeToDate(plainTime: Temporal.PlainTime): Date {
  const date = new Date();
  date.setHours(plainTime.hour, plainTime.minute, 0, 0);
  return date;
}

// Inline wrapper to share picker behavior and reduce component complexity.
function InlineDateTimePicker({
  display,
  mode,
  value,
  onSelect,
  onClose,
  textColor,
  themeVariant,
}: {
  display: "default" | "spinner" | "calendar" | "clock" | "inline";
  mode: "date" | "time";
  value: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
  textColor?: string;
  themeVariant?: "light" | "dark";
}) {
  return (
    <DateTimePicker
      display={display}
      mode={mode}
      onChange={(event: DateTimePickerEvent, date?: Date) => {
        if (event.type === "dismissed" || !date) {
          onClose();
          return;
        }

        onSelect(date);
        onClose();
      }}
      textColor={textColor}
      themeVariant={themeVariant}
      value={value}
    />
  );
}

// Date/time controls with inline pickers for the task form.
function TaskDateFields({
  draft,
  picker,
  dateDisplay,
  timeDisplay,
  pickerTextColor,
  pickerThemeVariant,
  setDraft,
  setPicker,
  timeZone,
}: {
  draft: TaskDraft;
  picker: TaskPickerState;
  dateDisplay: "default" | "spinner" | "calendar" | "clock" | "inline";
  timeDisplay: "default" | "spinner" | "calendar" | "clock" | "inline";
  pickerTextColor: string;
  pickerThemeVariant: "light" | "dark";
  setDraft: React.Dispatch<React.SetStateAction<TaskDraft>>;
  setPicker: React.Dispatch<React.SetStateAction<TaskPickerState>>;
  timeZone: string;
}) {
  return (
    <>
      {/* Due date */}
      <View className="mb-2.5">
        <Text className="text-muted-foreground text-xs">Due date</Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Button
            onPress={() => setPicker({ kind: "due", mode: "date" })}
            variant="outline"
          >
            <Text>
              {draft.dueDate ? formatPlainDateLong(draft.dueDate) : "Select"}
            </Text>
          </Button>
          {draft.dueDate ? (
            <Button
              accessibilityLabel="Clear due date"
              onPress={() => setDraft((d) => ({ ...d, dueDate: null }))}
              size="icon"
              variant="ghost"
            >
              <Icon as={X} size={16} />
            </Button>
          ) : null}
        </View>
      </View>
      {picker?.kind === "due" ? (
        <InlineDateTimePicker
          display={dateDisplay}
          mode={picker.mode}
          onClose={() => setPicker(null)}
          onSelect={(date) =>
            setDraft((d) => ({
              ...d,
              dueDate: dateToPlainDate(date, timeZone),
            }))
          }
          textColor={pickerTextColor}
          themeVariant={pickerThemeVariant}
          value={draft.dueDate ? plainDateToDate(draft.dueDate) : new Date()}
        />
      ) : null}

      {/* Start date */}
      <View className="mb-2.5">
        <Text className="text-muted-foreground text-xs">Start date</Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Button
            onPress={() => setPicker({ kind: "startDate", mode: "date" })}
            variant="outline"
          >
            <Text>
              {draft.startDate
                ? formatPlainDateShort(draft.startDate)
                : "Select"}
            </Text>
          </Button>
          {draft.startDate ? (
            <Button
              accessibilityLabel="Clear start date"
              onPress={() =>
                setDraft((d) => ({ ...d, startDate: null, startTime: null }))
              }
              size="icon"
              variant="ghost"
            >
              <Icon as={X} size={16} />
            </Button>
          ) : null}
        </View>
      </View>
      {picker?.kind === "startDate" ? (
        <InlineDateTimePicker
          display={dateDisplay}
          mode={picker.mode}
          onClose={() => setPicker(null)}
          onSelect={(date) =>
            setDraft((d) => ({
              ...d,
              startDate: dateToPlainDate(date, timeZone),
            }))
          }
          textColor={pickerTextColor}
          themeVariant={pickerThemeVariant}
          value={
            draft.startDate ? plainDateToDate(draft.startDate) : new Date()
          }
        />
      ) : null}

      {/* Start time */}
      <View className="mb-2.5">
        <Text className="text-muted-foreground text-xs">Start time</Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Button
            disabled={!draft.startDate}
            onPress={() => setPicker({ kind: "startTime", mode: "time" })}
            variant="outline"
          >
            <Text>
              {draft.startTime ? formatPlainTime(draft.startTime) : "Select"}
            </Text>
          </Button>
          {draft.startTime ? (
            <Button
              accessibilityLabel="Clear start time"
              onPress={() => setDraft((d) => ({ ...d, startTime: null }))}
              size="icon"
              variant="ghost"
            >
              <Icon as={X} size={16} />
            </Button>
          ) : null}
        </View>
      </View>
      {picker?.kind === "startTime" ? (
        <InlineDateTimePicker
          display={timeDisplay}
          mode={picker.mode}
          onClose={() => setPicker(null)}
          onSelect={(date) =>
            setDraft((d) => ({
              ...d,
              startTime: dateToPlainTime(date, timeZone),
            }))
          }
          textColor={pickerTextColor}
          themeVariant={pickerThemeVariant}
          value={
            draft.startTime ? plainTimeToDate(draft.startTime) : new Date()
          }
        />
      ) : null}
    </>
  );
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

type TaskPickerState =
  | { kind: "due"; mode: "date" }
  | { kind: "startDate"; mode: "date" }
  | { kind: "startTime"; mode: "time" }
  | null;

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

function buildEmptyDraft(timeZone: string): TaskDraft {
  // Default new tasks to start today and be due tomorrow.
  const today = Temporal.Now.plainDateISO(timeZone);
  const tomorrow = today.add({ days: 1 });

  return {
    title: "",
    description: "",
    durationMinutes: 30,
    dueDate: tomorrow,
    startDate: today,
    startTime: null,
  };
}

export default function TasksTab() {
  const navigation = useNavigation();
  const { isDarkColorScheme } = useColorScheme();
  const timeZone = getSystemTimeZone();

  const { tasksQuery, createTask, updateTask, deleteTask } = useTasks();
  const tasks = tasksQuery.data ?? [];

  // Inbox-like list: non-done tasks that are not scheduled (no startDate/time).
  const inboxTasks = tasks
    .filter((t) => t.status !== "done")
    .filter((t) => t.startDate === null && t.startTime === null)
    .filter((t) => t.seriesMasterId === null)
    .sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

  // Modal state (create/edit).
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingTask, setEditingTask] =
    React.useState<TaskSelectDecoded | null>(null);
  const [draft, setDraft] = React.useState<TaskDraft>(() =>
    buildEmptyDraft(timeZone)
  );
  const [isDurationPickerOpen, setIsDurationPickerOpen] = React.useState(false);
  // Track pending "done" actions so we can show undo for 5s.
  const [pendingDoneIds, setPendingDoneIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const pendingDoneTimeouts = React.useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );

  const durationHourOptions = React.useMemo(
    () => Array.from({ length: 6 }, (_, index) => index),
    []
  );
  const durationMinuteOptions = React.useMemo(() => [0, 15, 30, 45], []);
  const durationHours = Math.min(Math.floor(draft.durationMinutes / 60), 5);
  const durationMinutes = draft.durationMinutes % 60;
  const durationMinuteValue = durationMinuteOptions.includes(durationMinutes)
    ? durationMinutes
    : 0;
  // Use inline iOS pickers and keep text readable in dark mode.
  const datePickerDisplay = Platform.OS === "ios" ? "inline" : "default";
  const timePickerDisplay = Platform.OS === "ios" ? "spinner" : "default";
  const pickerTextColor = isDarkColorScheme ? "#fafafa" : "#0a0a0a";
  const pickerThemeVariant = isDarkColorScheme ? "dark" : "light";

  // Date/time picker state (native picker).
  const [picker, setPicker] = React.useState<TaskPickerState>(null);

  React.useEffect(() => {
    // Clean up any pending timeouts on unmount.
    return () => {
      pendingDoneTimeouts.current.forEach((timeoutId) =>
        clearTimeout(timeoutId)
      );
      pendingDoneTimeouts.current.clear();
    };
  }, []);

  const clearPendingDone = React.useCallback((taskId: string) => {
    const timeoutId = pendingDoneTimeouts.current.get(taskId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      pendingDoneTimeouts.current.delete(taskId);
    }
    setPendingDoneIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  const startPendingDone = React.useCallback(
    (task: TaskSelectDecoded) => {
      // Reset any existing timer so users always get a full undo window.
      const existingTimeout = pendingDoneTimeouts.current.get(task.id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      setPendingDoneIds((prev) => {
        const next = new Set(prev);
        next.add(task.id);
        return next;
      });

      const timeoutId = setTimeout(() => {
        updateTask.mutate({
          id: task.id,
          scope: "this",
          task: { status: "done" },
        });
        pendingDoneTimeouts.current.delete(task.id);
        setPendingDoneIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }, UNDO_DELAY_MS);

      pendingDoneTimeouts.current.set(task.id, timeoutId);
    },
    [updateTask]
  );

  const togglePendingDone = React.useCallback(
    (task: TaskSelectDecoded) => {
      if (pendingDoneIds.has(task.id)) {
        clearPendingDone(task.id);
        return;
      }
      startPendingDone(task);
    },
    [clearPendingDone, pendingDoneIds, startPendingDone]
  );

  // Memoize to keep the header action stable.
  const openCreate = React.useCallback(() => {
    const emptyDraft = buildEmptyDraft(timeZone);
    setEditingTask(null);
    setDraft(emptyDraft);
    setIsDurationPickerOpen(false);
    setIsModalOpen(true);
  }, [timeZone]);

  function openEdit(task: TaskSelectDecoded) {
    const nextDraft = buildDraftFromTask(task);
    setEditingTask(task);
    setDraft(nextDraft);
    setIsDurationPickerOpen(false);
    setIsModalOpen(true);
  }

  function closeModal() {
    setPicker(null);
    setIsDurationPickerOpen(false);
    setIsModalOpen(false);
  }

  function handleSave() {
    if (!draft.title.trim()) {
      return;
    }
    if (draft.durationMinutes <= 0) {
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

  function handleModalDone() {
    if (!editingTask) {
      return;
    }
    // Trigger the undoable "done" flow, then close the modal.
    startPendingDone(editingTask);
    closeModal();
  }

  React.useLayoutEffect(() => {
    // Keep the add action in the nav header to avoid duplicate titles.
    navigation.setOptions({
      headerRight: () => (
        <Button
          accessibilityLabel="New task"
          onPress={openCreate}
          size="icon"
          variant="ghost"
        >
          <Icon as={Plus} size={18} />
        </Button>
      ),
    });
  }, [navigation, openCreate]);

  return (
    <Container>
      {/* Task list */}
      <FlatList
        contentContainerClassName="px-4 pb-6 pt-2 gap-3"
        data={inboxTasks}
        keyExtractor={(t) => t.id}
        ListEmptyComponent={
          tasksQuery.isLoading ? (
            <Text className="pt-8 text-center text-muted-foreground">
              Loading...
            </Text>
          ) : (
            <Text className="pt-8 text-center text-muted-foreground">
              No tasks in inbox.
            </Text>
          )
        }
        refreshControl={
          <RefreshControl
            onRefresh={() => tasksQuery.refetch()}
            refreshing={tasksQuery.isFetching}
            tintColor={isDarkColorScheme ? "#fafafa" : "#0a0a0a"}
          />
        }
        renderItem={({ item }) => {
          const isPendingDone = pendingDoneIds.has(item.id);

          return (
            <Card className={cn("gap-3 py-3", isPendingDone && "opacity-70")}>
              <Pressable
                className="rounded-xl"
                onPress={() => openEdit(item)}
              >
                <CardContent className="px-4">
                  <View className="flex-row items-start gap-3">
                    <Checkbox
                      accessibilityLabel="Mark task done"
                      checked={isPendingDone}
                      onCheckedChange={() => togglePendingDone(item)}
                      onPress={(event) => event.stopPropagation()}
                    />
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text
                          className="flex-1 font-semibold text-base text-foreground"
                          numberOfLines={1}
                        >
                          {item.title}
                        </Text>
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-muted-foreground text-xs">
                            {item.durationMinutes}m
                          </Text>
                          {isPendingDone ? (
                            <Button
                              accessibilityLabel="Undo mark done"
                              onPress={(event) => {
                                event.stopPropagation();
                                clearPendingDone(item.id);
                              }}
                              size="icon"
                              variant="ghost"
                            >
                              <Icon as={Undo2} size={16} />
                            </Button>
                          ) : null}
                        </View>
                      </View>
                      {item.dueDate ? (
                        <>
                          <Separator className="my-2" />
                          <Text className="text-muted-foreground text-xs">
                            Due {formatPlainDateLong(item.dueDate)}
                          </Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                </CardContent>
              </Pressable>
            </Card>
          );
        }}
      />

      {/* Create/Edit Modal */}
      <Modal
        animationType="slide"
        onRequestClose={closeModal}
        transparent
        visible={isModalOpen}
      >
        <View className="flex-1 justify-end bg-black/35">
          <View className="rounded-t-2xl bg-background p-4">
            {/* Modal header */}
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="font-bold text-foreground text-lg">
                {editingTask ? "Edit task" : "New task"}
              </Text>
              <Button onPress={closeModal} size="sm" variant="ghost">
                <Text>Close</Text>
              </Button>
            </View>

            {editingTask ? (
              <View className="mb-3 flex-row items-center gap-2">
                <Checkbox
                  accessibilityLabel="Mark task done"
                  checked={pendingDoneIds.has(editingTask.id)}
                  onCheckedChange={handleModalDone}
                />
                <Text className="text-foreground text-sm">Mark done</Text>
              </View>
            ) : null}

            {/* Title input */}
            <Input
              className="mb-3"
              onChangeText={(value) =>
                setDraft((d) => ({ ...d, title: value }))
              }
              placeholder="Title"
              value={draft.title}
            />

            {/* Description textarea */}
            <Textarea
              className="mb-3"
              onChangeText={(value) =>
                setDraft((d) => ({ ...d, description: value }))
              }
              placeholder="Description (optional)"
              value={draft.description}
            />

            {/* Duration row */}
            <View className="mb-3 flex-row items-center gap-2">
              <Text className="font-semibold text-foreground text-sm">
                Duration
              </Text>
              <Button
                onPress={() => setIsDurationPickerOpen(true)}
                variant="outline"
              >
                <Text>{formatDurationMinutes(draft.durationMinutes)}</Text>
              </Button>
            </View>

            <TaskDateFields
              dateDisplay={datePickerDisplay}
              draft={draft}
              picker={picker}
              pickerTextColor={pickerTextColor}
              pickerThemeVariant={pickerThemeVariant}
              setDraft={setDraft}
              setPicker={setPicker}
              timeDisplay={timePickerDisplay}
              timeZone={timeZone}
            />

            {/* Modal footer */}
            <View className="mt-2 flex-row items-center justify-end gap-2.5">
              {editingTask ? (
                <Button onPress={handleDelete} variant="destructive">
                  <Text>Delete</Text>
                </Button>
              ) : null}

              <Button onPress={handleSave}>
                <Text>Save</Text>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Duration picker modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => setIsDurationPickerOpen(false)}
        transparent
        visible={isDurationPickerOpen}
      >
        <View className="flex-1 justify-end bg-black/35">
          <View className="rounded-t-2xl bg-background p-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="font-bold text-foreground text-lg">
                Duration
              </Text>
              <Button
                onPress={() => setIsDurationPickerOpen(false)}
                size="sm"
                variant="ghost"
              >
                <Text>Done</Text>
              </Button>
            </View>
            <View className="flex-row items-center gap-4">
              <View className="flex-1">
                <Text className="text-muted-foreground text-xs">Hours</Text>
                <Picker
                  dropdownIconColor={pickerTextColor}
                  onValueChange={(value: number) => {
                    const nextMinutes = value * 60 + durationMinuteValue;
                    setDraft((d) => ({ ...d, durationMinutes: nextMinutes }));
                  }}
                  selectedValue={durationHours}
                  style={{ color: pickerTextColor }}
                >
                  {durationHourOptions.map((value) => (
                    <Picker.Item
                      key={value}
                      label={`${value}h`}
                      value={value}
                    />
                  ))}
                </Picker>
              </View>
              <View className="flex-1">
                <Text className="text-muted-foreground text-xs">Minutes</Text>
                <Picker
                  dropdownIconColor={pickerTextColor}
                  onValueChange={(value: number) => {
                    const nextMinutes = durationHours * 60 + value;
                    setDraft((d) => ({ ...d, durationMinutes: nextMinutes }));
                  }}
                  selectedValue={durationMinuteValue}
                  style={{ color: pickerTextColor }}
                >
                  {durationMinuteOptions.map((value) => (
                    <Picker.Item
                      key={value}
                      label={`${String(value).padStart(2, "0")}m`}
                      value={value}
                    />
                  ))}
                </Picker>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Container>
  );
}
