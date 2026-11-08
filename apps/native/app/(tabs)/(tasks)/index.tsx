import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useTagTaskSections } from "@kompose/state/hooks/use-tag-task-sections";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTaskSections } from "@kompose/state/hooks/use-task-sections";
import {
  formatDuration,
  formatScheduledAt,
  getSystemTimeZone,
} from "@kompose/state/temporal-utils";
import { Stack } from "expo-router/stack";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Plus,
  Tag,
} from "lucide-react-native";
import React from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { Temporal } from "temporal-polyfill";
import { tagIconMap } from "@/components/tags/tag-icon-map";
import { TagManagerPopover } from "@/components/tags/tag-manager-popover";
import {
  type TaskDraft,
  TaskEditorSheet,
} from "@/components/tasks/task-editor-sheet";
import {
  TaskDeleteScopeDialog,
  TaskSaveScopeDialog,
} from "@/components/tasks/task-scope-dialogs";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTaskEditorFlow } from "@/hooks/use-task-editor-flow";
import { useColorScheme } from "@/lib/color-scheme-context";

function formatPlainDateShort(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(plainDateToDate(date));
}

// Convert a plain date into a JS Date using the device's local timezone.
function plainDateToDate(plainDate: Temporal.PlainDate): Date {
  return new Date(`${plainDate.toString()}T00:00:00`);
}

interface TaskSection {
  data: TaskSelectDecoded[];
  title: string;
  tone?: "overdue";
}

type BaseTaskTab = "Inbox" | "Today";

type TaskListItem =
  | { count: number; title: string; tone?: "overdue"; type: "header" }
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
    sections.push({ data: overdueTasks, title: "Overdue", tone: "overdue" });
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
    sections.push({ data: overdueTasks, title: "Overdue", tone: "overdue" });
  }
  if (todoTasks.length > 0) {
    sections.push({ data: todoTasks, title: "To do" });
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
    items.push({
      count: section.data.length,
      title: section.title,
      tone: section.tone,
      type: "header",
    });
    for (const task of section.data) {
      items.push({ task, type: "task" });
    }
  }
  return items;
}

function TaskRow({
  hiddenTagId,
  item,
  onPress,
  onToggleStatus,
  today,
}: {
  /** In a tag's own list, rows don't repeat that tag. */
  hiddenTagId: string | null;
  item: TaskSelectDecoded;
  onPress: (task: TaskSelectDecoded) => void;
  onToggleStatus: (task: TaskSelectDecoded) => void;
  today: Temporal.PlainDate;
}) {
  const tags = item.tags.filter((tag) => tag.id !== hiddenTagId);
  const scheduled =
    item.startDate && item.startTime
      ? item.startDate.toZonedDateTime({
          plainTime: item.startTime,
          timeZone: getSystemTimeZone(),
        })
      : null;
  const isDone = item.status === "done";
  const isPastDue =
    !isDone &&
    item.dueDate !== null &&
    Temporal.PlainDate.compare(item.dueDate, today) < 0;

  return (
    <View className="flex-row items-start gap-3 border-border/70 border-b py-3">
      <Checkbox
        accessibilityLabel={isDone ? "Mark as not done" : "Mark as done"}
        checked={isDone}
        className="mt-0.5"
        onCheckedChange={() => onToggleStatus(item)}
      />

      <Pressable
        accessibilityRole="button"
        className="flex-1 gap-1.5 active:opacity-70"
        onPress={() => onPress(item)}
      >
        <Text
          className={`text-base leading-snug ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <View className="flex-row items-center gap-1">
            <Icon as={Clock} className="text-muted-foreground" size={12} />
            <Text className="text-muted-foreground text-xs">
              {formatDuration(item.durationMinutes)}
            </Text>
          </View>
          {scheduled ? (
            <View className="flex-row items-center gap-1">
              <Icon
                as={CalendarClock}
                className="text-muted-foreground"
                size={12}
              />
              <Text className="text-muted-foreground text-xs">
                {formatScheduledAt(scheduled, today)}
              </Text>
            </View>
          ) : null}
          {item.dueDate ? (
            <View className="flex-row items-center gap-1">
              <Icon
                as={CalendarDays}
                className={
                  isPastDue ? "text-destructive" : "text-muted-foreground"
                }
                size={12}
              />
              <Text
                className={`text-xs ${isPastDue ? "text-destructive" : "text-muted-foreground"}`}
              >
                Due {formatPlainDateShort(item.dueDate)}
              </Text>
            </View>
          ) : null}
          {tags.map((tag) => (
            <View
              className="max-w-full flex-row items-center gap-1 rounded bg-foreground/[0.06] px-1.5 py-0.5"
              key={tag.id}
            >
              <Icon
                as={tagIconMap[tag.icon]}
                className="text-muted-foreground"
                size={12}
              />
              <Text
                className="shrink text-muted-foreground text-xs"
                numberOfLines={1}
              >
                {tag.name}
              </Text>
            </View>
          ))}
        </View>
      </Pressable>
    </View>
  );
}

interface TaskListProps {
  emptyMessage: string;
  hiddenTagId: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  items: TaskListItem[];
  onPressTask: (task: TaskSelectDecoded) => void;
  onRefresh: () => void;
  onToggleStatus: (task: TaskSelectDecoded) => void;
  tintColor: string;
}

function TaskList({
  items,
  emptyMessage,
  hiddenTagId,
  isLoading,
  isRefreshing,
  tintColor,
  onRefresh,
  onPressTask,
  onToggleStatus,
}: TaskListProps) {
  const today = Temporal.Now.plainDateISO(getSystemTimeZone());
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
          {isLoading ? "Loading tasks…" : emptyMessage}
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
          <View className="flex-row items-baseline gap-1.5 pt-5 pb-1">
            <Text
              className={`font-sans-medium text-sm ${item.tone === "overdue" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {item.title}
            </Text>
            <Text className="text-muted-foreground text-xs">{item.count}</Text>
          </View>
        ) : (
          <TaskRow
            hiddenTagId={hiddenTagId}
            item={item.task}
            onPress={onPressTask}
            onToggleStatus={onToggleStatus}
            today={today}
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

  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];

  const [selectedTagId, setSelectedTagId] = React.useState<string | null>(null);

  const {
    overdueTasks: tagOverdueTasks,
    todoTasks: tagTodoTasks,
    doneTasks: tagDoneTasks,
  } = useTagTaskSections(selectedTagId);

  const selectedTag = React.useMemo(
    () => tags.find((tag) => tag.id === selectedTagId) ?? null,
    [tags, selectedTagId]
  );

  const [activeTab, setActiveTab] = React.useState<BaseTaskTab>("Inbox");

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

  const SelectedTagIcon = selectedTag ? tagIconMap[selectedTag.icon] : Tag;
  const isTagView = selectedTagId !== null;

  let listItems: TaskListItem[];
  let emptyMessage: string;
  if (isTagView) {
    listItems = buildSectionItems(tagSections);
    emptyMessage = "No tasks with this tag yet.";
  } else if (activeTab === "Today") {
    listItems = buildSectionItems(todaySections);
    emptyMessage = "Nothing planned for today.";
  } else {
    listItems = inboxTasks.map((task) => ({ task, type: "task" }));
    emptyMessage = "Your inbox is empty. Tap + to add a task.";
  }

  return (
    <View className="flex-1 bg-background">
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
                  !isTagView && activeTab === "Inbox" ? "bg-foreground/15" : ""
                }`}
                onPress={() => selectBaseTab("Inbox")}
              >
                <Text
                  className={
                    !isTagView && activeTab === "Inbox"
                      ? "font-sans-medium text-foreground"
                      : "text-foreground"
                  }
                >
                  Inbox
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Show today tasks"
                className={`h-8 min-w-16 items-center justify-center rounded-full px-3 active:opacity-70 ${
                  !isTagView && activeTab === "Today" ? "bg-foreground/15" : ""
                }`}
                onPress={() => selectBaseTab("Today")}
              >
                <Text
                  className={
                    !isTagView && activeTab === "Today"
                      ? "font-sans-medium text-foreground"
                      : "text-foreground"
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

      <TaskList
        emptyMessage={emptyMessage}
        hiddenTagId={selectedTagId}
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
        isSaving={taskFlow.isSavingStatus}
        isVisible={taskFlow.isEditorOpen}
        mode={taskFlow.editingTask ? "edit" : "create"}
        onClose={taskFlow.close}
        onDelete={taskFlow.editingTask ? taskFlow.requestDelete : undefined}
        onSave={taskFlow.save}
        onToggleDone={taskFlow.editingTask ? taskFlow.toggleDone : undefined}
        overlay={<TaskSaveScopeDialog flow={taskFlow} />}
        savedRecurrence={taskFlow.savedRecurrence}
        setDraft={taskFlow.updateDraft}
        timeZone={timeZone}
        undatedMember={taskFlow.undatedMember}
      />

      <TaskDeleteScopeDialog flow={taskFlow} />

      <TagManagerPopover
        onChange={setSelectedTagId}
        onOpenChange={setIsTagManagerOpen}
        open={isTagManagerOpen}
        value={selectedTagId}
      />
    </View>
  );
}
