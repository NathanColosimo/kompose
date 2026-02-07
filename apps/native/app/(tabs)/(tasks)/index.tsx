import type {
  DeleteScope,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { useTagTaskSections } from "@kompose/state/hooks/use-tag-task-sections";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTaskSections } from "@kompose/state/hooks/use-task-sections";
import {
  TASK_DELETE_SCOPE_OPTIONS,
  TASK_UPDATE_SCOPE_OPTIONS,
} from "@kompose/state/recurrence-scope-options";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
  resolveTaskRecurrenceForEditor,
} from "@kompose/state/task-recurrence";
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
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { RadioGroup } from "@/components/ui/radio";
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

type BaseTaskTab = "Inbox" | "Today";
type TaskListMode = BaseTaskTab | "Tag";

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

function buildTagSections(
  overdueTasks: TaskSelectDecoded[],
  todoTasks: TaskSelectDecoded[],
  doneTasks: TaskSelectDecoded[]
): TaskSection[] {
  const sections: TaskSection[] = [];
  if (overdueTasks.length > 0) {
    sections.push({ title: "Overdue", data: overdueTasks });
  }
  if (todoTasks.length > 0) {
    sections.push({ title: "Todo", data: todoTasks });
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
  mode: TaskListMode;
  inboxTasks: TaskSelectDecoded[];
  todaySections: TaskSection[];
  tagSections: TaskSection[];
  tagName: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  tintColor: string;
  onRefresh: () => void;
  onPressTask: (task: TaskSelectDecoded) => void;
  onToggleStatus: (task: TaskSelectDecoded) => void;
}

// Shared list renderer for Inbox and Today views.
function TaskList({
  mode,
  inboxTasks,
  todaySections,
  tagSections,
  tagName,
  isLoading,
  isRefreshing,
  tintColor,
  onRefresh,
  onPressTask,
  onToggleStatus,
}: TaskListProps) {
  if (mode === "Inbox") {
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
              No tasks in inbox.
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

  const sectionItems = buildTodayItems(
    mode === "Today" ? todaySections : tagSections
  );
  const emptyMessage =
    mode === "Today"
      ? "Nothing for today."
      : tagName
        ? `No tasks for tag ${tagName}.`
        : "No tasks for this tag.";

  return (
    <FlatList
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      contentInsetAdjustmentBehavior="automatic"
      data={sectionItems}
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

function buildDraftFromTask(
  task: TaskSelectDecoded,
  recurrence: TaskSelectDecoded["recurrence"] = task.recurrence
): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    tagIds: task.tags.map((tag) => tag.id),
    durationMinutes: task.durationMinutes,
    status: task.status,
    dueDate: task.dueDate,
    startDate: task.startDate,
    startTime: task.startTime,
    recurrence: recurrence ?? null,
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
    status: "todo",
    dueDate: tomorrow,
    startDate: today,
    startTime: null,
    recurrence: null,
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
    () => buildTodaySections(overdueTasks, unplannedTasks, doneTasks),
    [doneTasks, overdueTasks, unplannedTasks]
  );
  const tagSections = React.useMemo(
    () => buildTagSections(tagOverdueTasks, tagTodoTasks, tagDoneTasks),
    [tagDoneTasks, tagOverdueTasks, tagTodoTasks]
  );

  // Modal state (create/edit).
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [isTagManagerOpen, setIsTagManagerOpen] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [editingTask, setEditingTask] =
    React.useState<TaskSelectDecoded | null>(null);
  const [pendingTaskSaveDraft, setPendingTaskSaveDraft] =
    React.useState<TaskDraft | null>(null);
  const [taskSaveScope, setTaskSaveScope] = React.useState<UpdateScope>("this");
  const [isTaskSaveScopeDialogVisible, setIsTaskSaveScopeDialogVisible] =
    React.useState(false);
  const [taskDeleteScope, setTaskDeleteScope] =
    React.useState<DeleteScope>("this");
  const [isTaskDeleteScopeDialogVisible, setIsTaskDeleteScopeDialogVisible] =
    React.useState(false);
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
    const allTasks = tasksQuery.data ?? [];
    const resolvedRecurrence = resolveTaskRecurrenceForEditor(task, allTasks);
    const nextEditingTask: TaskSelectDecoded = {
      ...task,
      recurrence: resolvedRecurrence,
    };
    const nextDraft = buildDraftFromTask(nextEditingTask, resolvedRecurrence);
    setEditingTask(nextEditingTask);
    setDraft(nextDraft);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingTask(null);
    setPendingTaskSaveDraft(null);
    setIsTaskSaveScopeDialogVisible(false);
    setIsTaskDeleteScopeDialogVisible(false);
  }

  function commitTaskUpdate(nextDraft: TaskDraft, scope: UpdateScope) {
    if (!editingTask) {
      return;
    }

    updateTask.mutate({
      id: editingTask.id,
      scope,
      task: {
        title: nextDraft.title.trim(),
        description: nextDraft.description.trim()
          ? nextDraft.description.trim()
          : null,
        tagIds: nextDraft.tagIds,
        durationMinutes: nextDraft.durationMinutes,
        dueDate: nextDraft.dueDate,
        startDate: nextDraft.startDate,
        startTime: nextDraft.startTime,
        recurrence: nextDraft.recurrence,
      },
    });
  }

  function handleSave() {
    if (!draft.title.trim()) {
      return;
    }
    if (draft.durationMinutes <= 0) {
      return;
    }

    if (editingTask) {
      const hasCoreFieldChanges = haveTaskCoreFieldsChanged({
        previous: {
          title: editingTask.title,
          description: editingTask.description,
          durationMinutes: editingTask.durationMinutes,
          dueDate: editingTask.dueDate,
          startDate: editingTask.startDate,
          startTime: editingTask.startTime,
        },
        next: {
          title: draft.title,
          description: draft.description,
          durationMinutes: draft.durationMinutes,
          dueDate: draft.dueDate,
          startDate: draft.startDate,
          startTime: draft.startTime,
        },
      });

      const decision = getTaskUpdateScopeDecision({
        isRecurring: editingTask.seriesMasterId !== null,
        isSeriesMaster: editingTask.seriesMasterId === editingTask.id,
        hasCoreFieldChanges,
        previousRecurrence: editingTask.recurrence,
        nextRecurrence: draft.recurrence,
        previousTagIds: editingTask.tags.map((tag) => tag.id),
        nextTagIds: draft.tagIds,
      });

      if (decision.action === "prompt") {
        setPendingTaskSaveDraft(draft);
        setTaskSaveScope(decision.defaultScope);
        setIsModalOpen(false);
        setIsTaskSaveScopeDialogVisible(true);
        return;
      }

      commitTaskUpdate(draft, decision.scope);
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
        recurrence: draft.recurrence,
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

    if (editingTask.seriesMasterId) {
      setTaskDeleteScope("this");
      setIsModalOpen(false);
      setIsTaskDeleteScopeDialogVisible(true);
      return;
    }

    deleteTask.mutate({ id: editingTask.id, scope: "this" });
    closeModal();
  }

  function confirmScopedTaskSave() {
    if (!(editingTask && pendingTaskSaveDraft)) {
      return;
    }
    commitTaskUpdate(pendingTaskSaveDraft, taskSaveScope);
    closeModal();
  }

  function confirmScopedTaskDelete() {
    if (!editingTask) {
      return;
    }
    deleteTask.mutate({ id: editingTask.id, scope: taskDeleteScope });
    closeModal();
  }

  function handleToggleDone(nextStatus: TaskDraft["status"]) {
    if (!editingTask) {
      return;
    }
    updateTask.mutate({
      id: editingTask.id,
      scope: "this",
      task: { status: nextStatus },
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

  const selectBaseTab = React.useCallback((tab: BaseTaskTab) => {
    setSelectedTagId(null);
    setActiveTab(tab);
  }, []);

  // Get the selected tag's icon component (or default Tag icon)
  const SelectedTagIcon = selectedTag ? tagIconMap[selectedTag.icon] : Tag;
  const isTagView = selectedTagId !== null;
  const taskListMode: TaskListMode = isTagView ? "Tag" : activeTab;

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
        inboxTasks={inboxTasks}
        isLoading={tasksQuery.isLoading}
        isRefreshing={isRefreshing}
        mode={taskListMode}
        onPressTask={openEdit}
        onRefresh={handleRefresh}
        onToggleStatus={handleToggleStatus}
        tagName={selectedTag?.name ?? null}
        tagSections={tagSections}
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
        timeZone={timeZone}
      />

      <AlertDialog
        confirmText="Apply"
        description="This is a recurring task. Choose how broadly to apply these updates."
        isVisible={isTaskSaveScopeDialogVisible}
        onCancel={closeModal}
        onClose={closeModal}
        onConfirm={confirmScopedTaskSave}
        title="Apply task update"
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) => setTaskSaveScope(value as UpdateScope)}
            options={TASK_UPDATE_SCOPE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={taskSaveScope}
          />
        </View>
      </AlertDialog>

      <AlertDialog
        confirmText="Delete"
        description="This is a recurring task. Choose what to delete."
        isVisible={isTaskDeleteScopeDialogVisible}
        onClose={closeModal}
        onConfirm={confirmScopedTaskDelete}
        title="Delete recurring task"
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) => setTaskDeleteScope(value as DeleteScope)}
            options={TASK_DELETE_SCOPE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={taskDeleteScope}
          />
        </View>
      </AlertDialog>

      <TagManagerPopover
        onChange={setSelectedTagId}
        onOpenChange={setIsTagManagerOpen}
        open={isTagManagerOpen}
        value={selectedTagId}
      />
    </View>
  );
}
