import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useTagTaskSections } from "@kompose/state/hooks/use-tag-task-sections";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTaskSections } from "@kompose/state/hooks/use-task-sections";
import { getSystemTimeZone } from "@kompose/state/temporal-utils";
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
import { TaskScopeDialogs } from "@/components/tasks/task-scope-dialogs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTaskEditorFlow } from "@/hooks/use-task-editor-flow";
import { useColorScheme } from "@/lib/color-scheme-context";

function formatPlainDateLong(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(plainDateToDate(date));
}

// Convert a plain date into a JS Date using the device's local timezone.
function plainDateToDate(plainDate: Temporal.PlainDate): Date {
  return new Date(`${plainDate.toString()}T00:00:00`);
}

interface TaskSection {
  data: TaskSelectDecoded[];
  title: string;
}

type BaseTaskTab = "Inbox" | "Today";

type TaskListItem =
  | { type: "header"; title: string }
  | { type: "task"; task: TaskSelectDecoded };

// Build the Today view sections to match the web Today view ordering.
function buildTodaySections(
  overdueTasks: TaskSelectDecoded[],
  plannedTasks: TaskSelectDecoded[],
  unplannedTasks: TaskSelectDecoded[],
  doneTasks: TaskSelectDecoded[]
): TaskSection[] {
  const sections: TaskSection[] = [];
  if (overdueTasks.length > 0) {
    sections.push({ data: overdueTasks, title: "Overdue" });
  }
  if (unplannedTasks.length > 0) {
    sections.push({ data: unplannedTasks, title: "Unplanned" });
  }
  if (plannedTasks.length > 0) {
    sections.push({ data: plannedTasks, title: "Planned" });
  }
  if (doneTasks.length > 0) {
    sections.push({ data: doneTasks, title: "Done" });
  }
  return sections;
}

function buildTagSections(
  overdueTasks: TaskSelectDecoded[],
  todoTasks: TaskSelectDecoded[],
  doneTasks: TaskSelectDecoded[]
): TaskSection[] {
  const sections: TaskSection[] = [];
  if (overdueTasks.length > 0) {
    sections.push({ data: overdueTasks, title: "Overdue" });
  }
  if (todoTasks.length > 0) {
    sections.push({ data: todoTasks, title: "Todo" });
  }
  if (doneTasks.length > 0) {
    sections.push({ data: doneTasks, title: "Done" });
  }
  return sections;
}

function buildSectionItems(sections: TaskSection[]): TaskListItem[] {
  const items: TaskListItem[] = [];
  for (const section of sections) {
    if (section.data.length === 0) {
      continue;
    }
    items.push({ title: section.title, type: "header" });
    for (const task of section.data) {
      items.push({ task, type: "task" });
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
  emptyMessage: string;
  isLoading: boolean;
  isRefreshing: boolean;
  items: TaskListItem[];
  onPressTask: (task: TaskSelectDecoded) => void;
  onRefresh: () => void;
  onToggleStatus: (task: TaskSelectDecoded) => void;
  tintColor: string;
}

// Shared list renderer for the Inbox, Today and tag views.
function TaskList({
  items,
  emptyMessage,
  isLoading,
  isRefreshing,
  tintColor,
  onRefresh,
  onPressTask,
  onToggleStatus,
}: TaskListProps) {
  return (
    <FlatList
      contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 16 }}
      contentInsetAdjustmentBehavior="automatic"
      data={items}
      keyExtractor={(item) =>
        item.type === "header" ? `header-${item.title}` : item.task.id
      }
      ListEmptyComponent={
        <Text className="pt-8 text-center text-muted-foreground">
          {isLoading ? "Loading..." : emptyMessage}
        </Text>
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

function buildEmptyDraft(timeZone: string): TaskDraft {
  const today = Temporal.Now.plainDateISO(timeZone);
  const tomorrow = today.add({ days: 1 });

  return {
    description: "",
    dueDate: tomorrow,
    durationMinutes: 30,
    linkInput: "",
    links: [],
    recurrence: null,
    startDate: today,
    startTime: null,
    status: "todo",
    tagIds: [],
    title: "",
  };
}

export default function TasksScreen() {
  const { isDarkColorScheme } = useColorScheme();
  const timeZone = getSystemTimeZone();

  const {
    tasksQuery,
    updateTask,
    inboxTasks,
    overdueTasks,
    plannedTasks,
    unplannedTasks,
    doneTasks,
  } = useTaskSections();

  // Get tags for the filter popover and header display
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];

  // Currently selected tag for filtering (null = show all)
  const [selectedTagId, setSelectedTagId] = React.useState<string | null>(null);

  const {
    overdueTasks: tagOverdueTasks,
    todoTasks: tagTodoTasks,
    doneTasks: tagDoneTasks,
  } = useTagTaskSections(selectedTagId);

  // Find the selected tag object to display its icon and name in the header
  const selectedTag = React.useMemo(
    () => tags.find((tag) => tag.id === selectedTagId) ?? null,
    [tags, selectedTagId]
  );

  // Track the active task view to mirror the web sidebar.
  const [activeTab, setActiveTab] = React.useState<BaseTaskTab>("Inbox");

  // Build the Today sections so the list can render headers.
  const todaySections = React.useMemo(
    () =>
      buildTodaySections(overdueTasks, plannedTasks, unplannedTasks, doneTasks),
    [doneTasks, overdueTasks, plannedTasks, unplannedTasks]
  );
  const tagSections = React.useMemo(
    () => buildTagSections(tagOverdueTasks, tagTodoTasks, tagDoneTasks),
    [tagDoneTasks, tagOverdueTasks, tagTodoTasks]
  );

  const [isTagManagerOpen, setIsTagManagerOpen] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const taskFlow = useTaskEditorFlow();

  function handleRefresh() {
    setIsRefreshing(true);
    tasksQuery.refetch().finally(() => {
      setIsRefreshing(false);
    });
  }

  // Toggle task status directly from the list (without opening modal)
  function handleToggleStatus(task: TaskSelectDecoded) {
    const newStatus = task.status === "done" ? "todo" : "done";
    updateTask.mutate({
      id: task.id,
      scope: "this",
      task: { status: newStatus },
    });
  }

  const selectBaseTab = React.useCallback((tab: BaseTaskTab) => {
    setSelectedTagId(null);
    setActiveTab(tab);
  }, []);

  // Get the selected tag's icon component (or default Tag icon)
  const SelectedTagIcon = selectedTag ? tagIconMap[selectedTag.icon] : Tag;
  const isTagView = selectedTagId !== null;

  let listItems: TaskListItem[];
  let emptyMessage: string;
  if (isTagView) {
    listItems = buildSectionItems(tagSections);
    emptyMessage = selectedTag?.name
      ? `No tasks for tag ${selectedTag.name}.`
      : "No tasks for this tag.";
  } else if (activeTab === "Today") {
    listItems = buildSectionItems(todaySections);
    emptyMessage = "Nothing for today.";
  } else {
    listItems = inboxTasks.map((task) => ({ task, type: "task" }));
    emptyMessage = "No tasks in inbox.";
  }

  return (
    <View className="flex-1 bg-background">
      {/* Configure header options via Stack.Screen */}
      <Stack.Screen
        options={{
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
                className={`h-8 min-w-16 items-center justify-center rounded-full px-3 active:opacity-70 ${
                  !isTagView && activeTab === "Inbox" ? "bg-muted" : ""
                }`}
                onPress={() => selectBaseTab("Inbox")}
              >
                <Text
                  className={
                    !isTagView && activeTab === "Inbox"
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  Inbox
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Show today tasks"
                className={`h-8 min-w-16 items-center justify-center rounded-full px-3 active:opacity-70 ${
                  !isTagView && activeTab === "Today" ? "bg-muted" : ""
                }`}
                onPress={() => selectBaseTab("Today")}
              >
                <Text
                  className={
                    !isTagView && activeTab === "Today"
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
                onPress={() => taskFlow.openCreate(buildEmptyDraft(timeZone))}
              >
                <Icon as={Plus} size={18} />
              </Pressable>
            </View>
          ),
          title: "Tasks",
        }}
      />

      {/* Task list */}
      <TaskList
        emptyMessage={emptyMessage}
        isLoading={tasksQuery.isLoading}
        isRefreshing={isRefreshing}
        items={listItems}
        onPressTask={taskFlow.openEdit}
        onRefresh={handleRefresh}
        onToggleStatus={handleToggleStatus}
        tintColor={isDarkColorScheme ? "#fafafa" : "#0a0a0a"}
      />

      <TaskEditorSheet
        draft={taskFlow.draft}
        isVisible={taskFlow.isEditorOpen}
        mode={taskFlow.editingTask ? "edit" : "create"}
        onClose={taskFlow.close}
        onDelete={taskFlow.editingTask ? taskFlow.requestDelete : undefined}
        onSave={taskFlow.save}
        onToggleDone={taskFlow.editingTask ? taskFlow.toggleDone : undefined}
        setDraft={taskFlow.updateDraft}
        timeZone={timeZone}
      />

      <TaskScopeDialogs flow={taskFlow} />

      <TagManagerPopover
        onChange={setSelectedTagId}
        onOpenChange={setIsTagManagerOpen}
        open={isTagManagerOpen}
        value={selectedTagId}
      />
    </View>
  );
}
