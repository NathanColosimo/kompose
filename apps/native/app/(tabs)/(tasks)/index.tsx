import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTaskSections } from "@kompose/state/hooks/use-task-sections";
import { Stack } from "expo-router/stack";
import { Plus, Tag } from "lucide-react-native";
import React from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { Temporal } from "temporal-polyfill";
import { tagIconMap } from "@/components/tags/tag-icon-map";
import { TagManagerPopover } from "@/components/tags/tag-manager-popover";
import {
  type TaskDraft,
  TaskEditorSheet,
} from "@/components/tasks/task-editor-sheet";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/color-scheme-context";

function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

function formatPlainDateLong(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(plainDateToDate(date));
}

// Convert a plain date into a JS Date using the device's local timezone.
function plainDateToDate(plainDate: Temporal.PlainDate): Date {
  return new Date(`${plainDate.toString()}T00:00:00`);
}

interface TaskSection {
  title: string;
  data: TaskSelectDecoded[];
}

type TaskListItem =
  | { type: "header"; title: string }
  | { type: "task"; task: TaskSelectDecoded };

// Build the Today view sections (Overdue and Unplanned).
function buildTodaySections(
  overdueTasks: TaskSelectDecoded[],
  unplannedTasks: TaskSelectDecoded[],
  doneTasks: TaskSelectDecoded[]
): TaskSection[] {
  const sections: TaskSection[] = [];
  if (overdueTasks.length > 0) {
    sections.push({ title: "Overdue", data: overdueTasks });
  }
  if (unplannedTasks.length > 0) {
    sections.push({ title: "Unplanned", data: unplannedTasks });
  }
  if (doneTasks.length > 0) {
    sections.push({ title: "Done", data: doneTasks });
  }
  return sections;
}

function buildTodayItems(sections: TaskSection[]): TaskListItem[] {
  const items: TaskListItem[] = [];
  for (const section of sections) {
    if (section.data.length === 0) {
      continue;
    }
    items.push({ type: "header", title: section.title });
    for (const task of section.data) {
      items.push({ type: "task", task });
    }
  }
  return items;
}

// Shared row renderer for task list items.
function TaskRow({
  item,
  onPress,
  onToggleStatus,
}: {
  item: TaskSelectDecoded;
  onPress: (task: TaskSelectDecoded) => void;
  onToggleStatus: (task: TaskSelectDecoded) => void;
}) {
  const selectedTags = item.tags;
  const isDone = item.status === "done";

  return (
    <View className="flex-row items-start gap-3 border-border border-b py-3">
      {/* Checkbox to toggle done/todo status */}
      <Checkbox
        accessibilityLabel={isDone ? "Mark as todo" : "Mark as done"}
        checked={isDone}
        className="mt-0.5"
        onCheckedChange={() => onToggleStatus(item)}
      />

      {/* Task content - tappable to open edit modal */}
      <Pressable
        className="flex-1 active:opacity-70"
        onPress={() => onPress(item)}
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text
            className={`flex-1 font-semibold text-base ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text className="text-muted-foreground text-xs">
            {item.durationMinutes}m
          </Text>
        </View>
        {item.dueDate ? (
          <Text className="mt-1 text-muted-foreground text-xs">
            Due {formatPlainDateLong(item.dueDate)}
          </Text>
        ) : null}
        {selectedTags.length > 0 ? (
          <View className="mt-1 flex-row flex-wrap gap-2">
            {selectedTags.map((tag) => {
              const IconComponent = tagIconMap[tag.icon];
              return (
                <Badge key={tag.id} variant="outline">
                  <View className="flex-row items-center gap-1">
                    <Icon
                      as={IconComponent}
                      className="text-muted-foreground"
                      size={12}
                    />
                    <Text className="text-muted-foreground text-xs">
                      {tag.name}
                    </Text>
                  </View>
                </Badge>
              );
            })}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

interface TaskListProps {
  activeTab: "Inbox" | "Today";
  inboxTasks: TaskSelectDecoded[];
  todaySections: TaskSection[];
  isLoading: boolean;
  isRefreshing: boolean;
  tintColor: string;
  onRefresh: () => void;
  onPressTask: (task: TaskSelectDecoded) => void;
  onToggleStatus: (task: TaskSelectDecoded) => void;
}

// Shared list renderer for Inbox and Today views.
function TaskList({
  activeTab,
  inboxTasks,
  todaySections,
  isLoading,
  isRefreshing,
  tintColor,
  onRefresh,
  onPressTask,
  onToggleStatus,
}: TaskListProps) {
  const emptyMessage =
    activeTab === "Inbox" ? "No tasks in inbox." : "Nothing for today.";

  if (activeTab === "Inbox") {
    return (
      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        contentInsetAdjustmentBehavior="automatic"
        data={inboxTasks}
        keyExtractor={(t) => t.id}
        ListEmptyComponent={
          isLoading ? (
            <Text className="pt-8 text-center text-muted-foreground">
              Loading...
            </Text>
          ) : (
            <Text className="pt-8 text-center text-muted-foreground">
              {emptyMessage}
            </Text>
          )
        }
        refreshControl={
          <RefreshControl
            onRefresh={onRefresh}
            refreshing={isRefreshing}
            tintColor={tintColor}
          />
        }
        renderItem={({ item }) => (
          <TaskRow
            item={item}
            onPress={onPressTask}
            onToggleStatus={onToggleStatus}
          />
        )}
      />
    );
  }

  const todayItems = buildTodayItems(todaySections);

  return (
    <FlatList
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      contentInsetAdjustmentBehavior="automatic"
      data={todayItems}
      keyExtractor={(item) =>
        item.type === "header" ? `header-${item.title}` : item.task.id
      }
      ListEmptyComponent={
        isLoading ? (
          <Text className="pt-8 text-center text-muted-foreground">
            Loading...
          </Text>
        ) : (
          <Text className="pt-8 text-center text-muted-foreground">
            {emptyMessage}
          </Text>
        )
      }
      refreshControl={
        <RefreshControl
          onRefresh={onRefresh}
          refreshing={isRefreshing}
          tintColor={tintColor}
        />
      }
      renderItem={({ item }) =>
        item.type === "header" ? (
          <Text className="py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {item.title}
          </Text>
        ) : (
          <TaskRow
            item={item.task}
            onPress={onPressTask}
            onToggleStatus={onToggleStatus}
          />
        )
      }
    />
  );
}

function buildDraftFromTask(task: TaskSelectDecoded): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    tagIds: task.tags.map((tag) => tag.id),
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
    tagIds: [],
    durationMinutes: 30,
    dueDate: tomorrow,
    startDate: today,
    startTime: null,
  };
}

export default function TasksScreen() {
  const { isDarkColorScheme } = useColorScheme();
  const timeZone = getSystemTimeZone();

  const {
    tasksQuery,
    createTask,
    updateTask,
    deleteTask,
    inboxTasks,
    overdueTasks,
    unplannedTasks,
    doneTasks,
  } = useTaskSections();

  // Get tags for the filter popover and header display
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];

  // Currently selected tag for filtering (null = show all)
  const [selectedTagId, setSelectedTagId] = React.useState<string | null>(null);

  // Find the selected tag object to display its icon and name in the header
  const selectedTag = React.useMemo(
    () => tags.find((tag) => tag.id === selectedTagId) ?? null,
    [tags, selectedTagId]
  );

  // Track the active task view to mirror the web sidebar.
  const [activeTab, setActiveTab] = React.useState<"Inbox" | "Today">("Inbox");

  // Build the Today sections so the list can render headers.
  const todaySections = React.useMemo(
    () => buildTodaySections(overdueTasks, unplannedTasks, doneTasks),
    [doneTasks, overdueTasks, unplannedTasks]
  );

  // Modal state (create/edit).
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [isTagManagerOpen, setIsTagManagerOpen] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [editingTask, setEditingTask] =
    React.useState<TaskSelectDecoded | null>(null);
  const [draft, setDraft] = React.useState<TaskDraft>(() =>
    buildEmptyDraft(timeZone)
  );

  // Memoize to keep the header action stable.
  const openCreate = React.useCallback(() => {
    const emptyDraft = buildEmptyDraft(timeZone);
    setEditingTask(null);
    setDraft(emptyDraft);
    setIsModalOpen(true);
  }, [timeZone]);

  function openEdit(task: TaskSelectDecoded) {
    const nextDraft = buildDraftFromTask(task);
    setEditingTask(task);
    setDraft(nextDraft);
    setIsModalOpen(true);
  }

  function closeModal() {
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
          tagIds: draft.tagIds,
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
        tagIds: draft.tagIds,
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

  const handleRefresh = React.useCallback(() => {
    setIsRefreshing(true);
    tasksQuery.refetch().finally(() => {
      setIsRefreshing(false);
    });
  }, [tasksQuery]);

  // Toggle task status directly from the list (without opening modal)
  const handleToggleStatus = React.useCallback(
    (task: TaskSelectDecoded) => {
      const newStatus = task.status === "done" ? "todo" : "done";
      updateTask.mutate({
        id: task.id,
        task: { status: newStatus },
        scope: "this",
      });
    },
    [updateTask]
  );

  // Get the selected tag's icon component (or default Tag icon)
  const SelectedTagIcon = selectedTag ? tagIconMap[selectedTag.icon] : Tag;

  return (
    <View className="flex-1 bg-background">
      {/* Configure header options via Stack.Screen */}
      <Stack.Screen
        options={{
          title: "Tasks",
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Manage tags"
              className="flex-row items-center gap-1.5 rounded-lg py-1.5 pr-3 pl-4 active:opacity-70"
              onPress={() => setIsTagManagerOpen(true)}
            >
              <Icon as={SelectedTagIcon} size={18} />
              {selectedTag ? (
                <Text className="font-medium text-foreground text-sm">
                  {selectedTag.name}
                </Text>
              ) : null}
            </Pressable>
          ),
          headerRight: () => (
            <View className="flex-row items-center gap-1.5 pr-2">
              <Pressable
                accessibilityLabel="Show inbox tasks"
                className={`rounded-lg px-2.5 py-1.5 active:opacity-70 ${
                  activeTab === "Inbox" ? "bg-muted" : ""
                }`}
                onPress={() => setActiveTab("Inbox")}
              >
                <Text
                  className={
                    activeTab === "Inbox"
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  Inbox
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Show today tasks"
                className={`rounded-lg px-2.5 py-1.5 active:opacity-70 ${
                  activeTab === "Today" ? "bg-muted" : ""
                }`}
                onPress={() => setActiveTab("Today")}
              >
                <Text
                  className={
                    activeTab === "Today"
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  Today
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="New task"
                className="items-center justify-center rounded-lg p-1.5 active:opacity-70"
                onPress={openCreate}
              >
                <Icon as={Plus} size={18} />
              </Pressable>
            </View>
          ),
        }}
      />

      {/* Task list */}
      <TaskList
        activeTab={activeTab}
        inboxTasks={inboxTasks}
        isLoading={tasksQuery.isLoading}
        isRefreshing={isRefreshing}
        onPressTask={openEdit}
        onRefresh={handleRefresh}
        onToggleStatus={handleToggleStatus}
        tintColor={isDarkColorScheme ? "#fafafa" : "#0a0a0a"}
        todaySections={todaySections}
      />

      <TaskEditorSheet
        draft={draft}
        isVisible={isModalOpen}
        mode={editingTask ? "edit" : "create"}
        onClose={closeModal}
        onDelete={editingTask ? handleDelete : undefined}
        onSave={handleSave}
        onToggleDone={editingTask ? handleToggleDone : undefined}
        setDraft={setDraft}
        snapPoints={[0.7, 0.92, 0.98]}
        status={editingTask?.status ?? null}
        timeZone={timeZone}
      />

      <TagManagerPopover
        onChange={setSelectedTagId}
        onOpenChange={setIsTagManagerOpen}
        open={isTagManagerOpen}
        value={selectedTagId}
      />
    </View>
  );
}
