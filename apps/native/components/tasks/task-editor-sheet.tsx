import type { TagSelect } from "@kompose/api/routers/tag/contract";
import type {
  LinkMeta,
  TaskRecurrence,
} from "@kompose/api/routers/task/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  dedupeLinks,
  getLinkDurationMinutes,
  getLinkWordCount,
  getProviderLabel,
  URL_REGEX,
} from "@kompose/state/link-meta-utils";
import {
  buildTaskRecurrence,
  getTaskRecurrenceDisplayText,
  getTaskRecurrenceEditorState,
  getTaskRecurrenceIntervalLabel,
  repeatNote,
  TASK_RECURRENCE_DAYS,
  type TaskRecurrenceDayCode,
  type TaskRecurrenceEditorState,
  type TaskRecurrenceFrequency,
  toggleTaskRecurrenceDay,
} from "@kompose/state/task-recurrence";
import { formatDuration } from "@kompose/state/temporal-utils";
import { Image } from "expo-image";
import {
  Check,
  Link2,
  Loader2,
  Minus,
  Plus,
  Repeat2,
  Trash2,
  XCircle,
} from "lucide-react-native";
import React from "react";
import { Linking, Pressable, useWindowDimensions, View } from "react-native";
import { Temporal } from "temporal-polyfill";
import { tagIconMap } from "@/components/tags/tag-icon-map";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import type { TaskSeries } from "@/hooks/use-task-editor-flow";
import {
  formatShortDate,
  localeTimeFormat,
  plainDateToDate,
  spokenDuration,
} from "@/lib/time-format";

export interface TaskDraft {
  description: string;
  dueDate: Temporal.PlainDate | null;
  durationMinutes: number;
  /** Current text in the link input field (not yet added to links array) */
  linkInput: string;
  links: LinkMeta[];
  recurrence: TaskRecurrence | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
  status: "todo" | "in_progress" | "done";
  tagIds: string[];
  title: string;
}

interface TaskEditorSheetProps {
  /** The draft can save now (see useTaskEditorFlow); Mark done saves too. */
  canSave: boolean;
  draft: TaskDraft | null;
  /** A save is running: the editor holds, read-only, until it ends. */
  isSaving?: boolean;
  isVisible: boolean;
  mode: "create" | "edit";
  onClose: () => void;
  onDelete?: () => void;
  onSave: () => void;
  onToggleDone?: (nextStatus: TaskDraft["status"]) => void;
  /** Dialogs that open over the editor (iOS presents them from its modal). */
  overlay?: React.ReactNode;
  /** The series of the task being edited, so a repeat change can say what it does. */
  series: TaskSeries | null;
  setDraft: (updater: (previous: TaskDraft) => TaskDraft) => void;
  timeZone: string;
}

const DURATION_MINUTE_OPTIONS = [0, 15, 30, 45];
const DAY_NAMES: Record<TaskRecurrenceDayCode, string> = {
  FR: "Friday",
  MO: "Monday",
  SA: "Saturday",
  SU: "Sunday",
  TH: "Thursday",
  TU: "Tuesday",
  WE: "Wednesday",
};
const RECURRENCE_FREQUENCIES: Array<{
  value: TaskRecurrenceFrequency | "NONE";
  label: string;
}> = [
  { label: "None", value: "NONE" },
  { label: "Daily", value: "DAILY" },
  { label: "Weekly", value: "WEEKLY" },
  { label: "Monthly", value: "MONTHLY" },
  { label: "Yearly", value: "YEARLY" },
];

function plainTimeToDate(plainTime: Temporal.PlainTime): Date {
  const date = new Date();
  date.setHours(plainTime.hour, plainTime.minute, 0, 0);
  return date;
}

function dateToPlainDate(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  });
}

function dateToPlainTime(date: Date): Temporal.PlainTime {
  return Temporal.PlainTime.from({
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: 0,
  });
}

/** In the locale's hour cycle ("4:30 PM"), like the calendar block. */
function formatPlainTime(time: Temporal.PlainTime | null): string {
  if (!time) {
    // A placeholder like the "Start" and "Due" chips beside it.
    return "Time";
  }
  return time.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
}

function TaskRecurrenceEndSection({
  recurrenceState,
  fallbackUntil,
  updateRecurrence,
}: {
  recurrenceState: TaskRecurrenceEditorState;
  /** The task's start (or today): the earliest the repeat can end. */
  fallbackUntil: Temporal.PlainDate;
  updateRecurrence: (patch: Partial<TaskRecurrenceEditorState>) => void;
}) {
  return (
    <View className="mt-3">
      <Text className="text-muted-foreground text-xs">Ends</Text>
      <View className="mt-1 flex-row flex-wrap gap-2">
        <Button
          accessibilityState={{ selected: recurrenceState.endType === "never" }}
          onPress={() => updateRecurrence({ endType: "never", until: null })}
          size="sm"
          style={{ borderRadius: 999 }}
          variant={recurrenceState.endType === "never" ? "default" : "outline"}
        >
          <Text>Never</Text>
        </Button>
        <Button
          accessibilityState={{ selected: recurrenceState.endType === "until" }}
          onPress={() =>
            updateRecurrence({
              endType: "until",
              until: recurrenceState.until ?? fallbackUntil,
            })
          }
          size="sm"
          style={{ borderRadius: 999 }}
          variant={recurrenceState.endType === "until" ? "default" : "outline"}
        >
          <Text>On date</Text>
        </Button>
        <Button
          accessibilityState={{ selected: recurrenceState.endType === "count" }}
          onPress={() =>
            updateRecurrence({
              count:
                Number.isFinite(recurrenceState.count) &&
                recurrenceState.count > 0
                  ? recurrenceState.count
                  : 10,
              endType: "count",
            })
          }
          size="sm"
          style={{ borderRadius: 999 }}
          variant={recurrenceState.endType === "count" ? "default" : "outline"}
        >
          <Text>After N</Text>
        </Button>
      </View>

      {recurrenceState.endType === "until" ? (
        <View className="mt-2" style={{ maxWidth: 220 }}>
          <DatePicker
            accessibilityLabel="Repeat until"
            displayValue={
              recurrenceState.until
                ? formatShortDate(recurrenceState.until)
                : "Until date"
            }
            // The repeat can't end before the task starts.
            minimumDate={plainDateToDate(fallbackUntil)}
            mode="date"
            onChange={(date) =>
              updateRecurrence({
                until: date ? dateToPlainDate(date) : null,
              })
            }
            placeholder="Until date"
            showIcon={false}
            style={{
              borderRadius: 999,
              minHeight: 44,
              paddingHorizontal: 10,
            }}
            value={
              recurrenceState.until
                ? plainDateToDate(recurrenceState.until)
                : undefined
            }
            valueTextStyle={{ fontSize: 13 }}
            variant="outline"
          />
        </View>
      ) : null}

      {recurrenceState.endType === "count" ? (
        <View className="mt-2 flex-row items-center gap-2">
          <Input
            accessibilityLabel="Number of occurrences"
            containerStyle={{ width: 78 }}
            inputStyle={{ fontSize: 17 }}
            keyboardType="number-pad"
            onChangeText={(value) => {
              const nextCount = Number.parseInt(value, 10) || 1;
              updateRecurrence({ count: nextCount });
            }}
            pill
            value={String(recurrenceState.count)}
            variant="outline"
          />
          <Text className="text-foreground text-xs">occurrences</Text>
        </View>
      ) : null}
    </View>
  );
}

function TaskRecurrenceEditor({
  recurrenceState,
  recurrenceSummary,
  activeFrequency,
  hasRecurrence,
  fallbackUntil,
  handleSelectFrequency,
  updateRecurrence,
}: {
  recurrenceState: TaskRecurrenceEditorState;
  recurrenceSummary: string;
  activeFrequency: TaskRecurrenceFrequency | "NONE";
  hasRecurrence: boolean;
  fallbackUntil: Temporal.PlainDate;
  handleSelectFrequency: (freq: TaskRecurrenceFrequency | "NONE") => void;
  updateRecurrence: (patch: Partial<TaskRecurrenceEditorState>) => void;
}) {
  return (
    <View className="mb-2.5 rounded-md border border-border px-3 py-3">
      <Text className="font-semibold text-foreground text-sm">Repeat</Text>
      {/* The pattern in words; with no repeat, "None" below says it. */}
      {hasRecurrence ? (
        <Text className="mt-0.5 text-muted-foreground text-xs">
          {recurrenceSummary}
        </Text>
      ) : null}

      <View className="mt-2 flex-row flex-wrap gap-2">
        {RECURRENCE_FREQUENCIES.map((frequency) => {
          const active = activeFrequency === frequency.value;
          return (
            <Button
              accessibilityState={{ selected: active }}
              key={frequency.value}
              onPress={() => handleSelectFrequency(frequency.value)}
              size="sm"
              style={{ borderRadius: 999 }}
              variant={active ? "default" : "outline"}
            >
              <Text>{frequency.label}</Text>
            </Button>
          );
        })}
      </View>

      {hasRecurrence ? (
        <>
          <View className="mt-3 flex-row items-center gap-2">
            <Text className="text-muted-foreground text-xs">Every</Text>
            <Input
              accessibilityLabel="Repeat every"
              containerStyle={{ width: 78 }}
              inputStyle={{ fontSize: 17 }}
              keyboardType="number-pad"
              onChangeText={(value) => {
                const nextInterval = Number.parseInt(value, 10) || 1;
                updateRecurrence({ interval: nextInterval });
              }}
              pill
              value={String(recurrenceState.interval)}
              variant="outline"
            />
            <Text className="text-foreground text-xs">
              {getTaskRecurrenceIntervalLabel(
                recurrenceState.freq,
                recurrenceState.interval
              )}
            </Text>
          </View>

          {recurrenceState.freq === "WEEKLY" ? (
            <View className="mt-3">
              <Text className="text-muted-foreground text-xs">On days</Text>
              <View className="mt-1 flex-row flex-wrap gap-2">
                {TASK_RECURRENCE_DAYS.map((day) => {
                  const selected = recurrenceState.byDay.includes(day.value);
                  return (
                    <Button
                      // "T" and "S" each stand for two days.
                      accessibilityLabel={DAY_NAMES[day.value]}
                      accessibilityState={{ selected }}
                      key={day.value}
                      onPress={() =>
                        updateRecurrence({
                          byDay: toggleTaskRecurrenceDay(
                            recurrenceState.byDay,
                            day.value
                          ),
                        })
                      }
                      size="sm"
                      style={{ borderRadius: 999 }}
                      variant={selected ? "default" : "outline"}
                    >
                      <Text>{day.shortLabel}</Text>
                    </Button>
                  );
                })}
              </View>
            </View>
          ) : null}

          {recurrenceState.freq === "MONTHLY" ? (
            <View className="mt-3 flex-row items-center gap-2">
              <Text className="text-muted-foreground text-xs">On day</Text>
              <Input
                accessibilityLabel="Day of month"
                containerStyle={{ width: 78 }}
                inputStyle={{ fontSize: 17 }}
                keyboardType="number-pad"
                onChangeText={(value) => {
                  const nextMonthDay = Number.parseInt(value, 10) || 1;
                  updateRecurrence({ byMonthDay: nextMonthDay });
                }}
                pill
                value={String(recurrenceState.byMonthDay)}
                variant="outline"
              />
              <Text className="text-foreground text-xs">of month</Text>
            </View>
          ) : null}

          <TaskRecurrenceEndSection
            fallbackUntil={fallbackUntil}
            recurrenceState={recurrenceState}
            updateRecurrence={updateRecurrence}
          />
        </>
      ) : null}
    </View>
  );
}

function TaskTagPill({
  tag,
  action,
  onPress,
}: {
  tag: TagSelect;
  action: "add" | "remove";
  onPress: () => void;
}) {
  const TagIcon = tagIconMap[tag.icon];
  const ActionIcon = action === "add" ? Plus : Minus;

  return (
    // A 44pt target around a 32pt pill. The negative margin keeps the rows'
    // spacing; hitSlop wouldn't do, since iOS clips it at the row's edge.
    <Pressable
      accessibilityLabel={`${action === "add" ? "Add" : "Remove"} tag ${tag.name}`}
      accessibilityRole="button"
      className="-my-1.5 py-1.5"
      onPress={onPress}
    >
      <View className="flex-row items-center gap-1.5 rounded-full border border-border px-2.5 py-2">
        <Icon as={TagIcon} className="text-muted-foreground" size={12} />
        <Text className="text-foreground text-xs">{tag.name}</Text>
        <Icon as={ActionIcon} className="text-muted-foreground" size={12} />
      </View>
    </Pressable>
  );
}

function TaskTagPicker({
  selectedTags,
  availableTags,
  isExpanded,
  onToggleExpanded,
  onAdd,
  onRemove,
}: {
  selectedTags: TagSelect[];
  availableTags: TagSelect[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onAdd: (tagId: string) => void;
  onRemove: (tagId: string) => void;
}) {
  return (
    <View className="mb-2.5 rounded-md border border-border px-3 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-foreground text-sm">Tags</Text>
        <Button
          accessibilityLabel={isExpanded ? "Hide tags" : "Add tags"}
          accessibilityState={{ expanded: isExpanded }}
          onPress={onToggleExpanded}
          size="icon"
          // 44pt to touch, laid out as 30pt (the negative margin), so the
          // row keeps its height; hitSlop would be clipped at the row's edge.
          style={{ borderRadius: 999, height: 44, margin: -7, width: 44 }}
          variant="ghost"
        >
          <Icon as={Plus} className="text-foreground" size={14} />
        </Button>
      </View>

      <View className="mt-2 flex-row flex-wrap gap-2">
        {selectedTags.length > 0 ? (
          selectedTags.map((tag) => (
            <TaskTagPill
              action="remove"
              key={`remove-${tag.id}`}
              onPress={() => onRemove(tag.id)}
              tag={tag}
            />
          ))
        ) : (
          <Text className="text-muted-foreground text-xs">
            No tags selected
          </Text>
        )}
      </View>

      {isExpanded ? (
        <>
          <View className="mt-2 border-border border-t" />
          <View className="mt-2 flex-row flex-wrap gap-2">
            {availableTags.length > 0 ? (
              availableTags.map((tag) => (
                <TaskTagPill
                  action="add"
                  key={`add-${tag.id}`}
                  onPress={() => onAdd(tag.id)}
                  tag={tag}
                />
              ))
            ) : (
              <Text className="text-muted-foreground text-xs">
                All tags selected
              </Text>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** The editor's header: delete, then save, or "Saving…" while a save runs. */
function TaskEditorHeaderActions({
  canSave,
  isSaving,
  onDelete,
  onSave,
}: {
  canSave: boolean;
  isSaving: boolean;
  onDelete?: () => void;
  onSave: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2">
      {onDelete ? (
        <Button
          accessibilityLabel="Delete task"
          disabled={isSaving}
          onPress={onDelete}
          size="icon"
          style={{ borderRadius: 999 }}
          variant="ghost"
        >
          <Icon
            as={Trash2}
            className={isSaving ? "text-muted-foreground" : "text-destructive"}
            size={18}
          />
        </Button>
      ) : null}
      {isSaving ? (
        <Text className="px-2 text-muted-foreground text-sm">Saving…</Text>
      ) : (
        <Button
          accessibilityLabel="Save task"
          disabled={!canSave}
          onPress={onSave}
          size="icon"
          style={{ borderRadius: 999 }}
          variant="ghost"
        >
          <Icon
            as={Check}
            // Ink, not a light green: it reads on the cream sheet.
            className={canSave ? "text-primary" : "text-muted-foreground"}
            size={18}
          />
        </Button>
      )}
    </View>
  );
}

/**
 * Durations in 15-minute steps from 15m up to a day, plus the task's own
 * when it's off-step (a 20-minute task from web), so the chip shows it.
 */
function durationOptionsFor(current: number) {
  const minutes = Array.from({ length: 24 }, (_, hour) =>
    DURATION_MINUTE_OPTIONS.map((minute) => hour * 60 + minute)
  )
    .flat()
    .filter((total) => total > 0);
  if (!minutes.includes(current)) {
    minutes.push(current);
    minutes.sort((a, b) => a - b);
  }
  return minutes.map((total) => ({
    label: formatDuration(total),
    value: String(total),
  }));
}

/** What the repeat will do, or why it can't save (repeatNote). */
function RepeatNote({
  note,
}: {
  note: { blocking: boolean; text: string } | null;
}) {
  if (!note) {
    return null;
  }
  return (
    <Text
      className={`mb-2.5 text-xs ${note.blocking ? "text-destructive" : "text-muted-foreground"}`}
    >
      {note.text}
    </Text>
  );
}

/**
 * The schedule row: duration, start date and time, due date, and the
 * Repeat toggle.
 */
function TaskScheduleChips({
  draft,
  isRecurrenceExpanded,
  onToggleRecurrence,
  recurrenceSummary,
  setDraft,
}: {
  draft: TaskDraft;
  isRecurrenceExpanded: boolean;
  onToggleRecurrence: () => void;
  recurrenceSummary: string;
  setDraft: (updater: (previous: TaskDraft) => TaskDraft) => void;
}) {
  const { fontScale } = useWindowDimensions();
  // The chips' text grows with Dynamic Type, so their widths grow with it.
  const chipWidth = (width: number) =>
    Math.round(width * Math.max(1, fontScale));

  // Each chip is as wide as its widest value at 1x in Sentient 13pt, plus
  // 10pt of padding and border ("May 20" 45, "10:00 AM" 58, "Due May 20"
  // 73), scaled with the text, so nothing truncates. One row down to 375pt
  // at the default size (64 + 56 + 70 + 86 + 44 + gaps = 332); as the text
  // grows, the row wraps.
  return (
    <View className="mb-3 flex-row flex-wrap items-center gap-1">
      {/* Picker takes no accessibility props, so this names it. */}
      <View
        accessibilityLabel={`Duration, ${spokenDuration(draft.durationMinutes)}`}
        accessibilityRole="button"
        accessible
        style={{ width: chipWidth(64) }}
      >
        <Picker
          // Same size as the date and time chips beside it.
          inputStyle={{ fontSize: 13, textAlign: "center" }}
          modalTitle="Duration"
          onValueChange={(value) => {
            const nextMinutes = Number.parseInt(value, 10);
            if (!Number.isFinite(nextMinutes)) {
              return;
            }
            setDraft((current) => ({
              ...current,
              durationMinutes: nextMinutes,
            }));
          }}
          options={durationOptionsFor(draft.durationMinutes)}
          placeholder="Duration"
          showChevron={false}
          style={{ borderRadius: 999, minHeight: 44, paddingHorizontal: 0 }}
          value={String(draft.durationMinutes)}
          variant="outline"
        />
      </View>

      {/* Grows to fill its line, never below its text: the minimum, not
          the basis, is what makes the row wrap instead of crushing it. */}
      <View style={{ flexGrow: 1, minWidth: chipWidth(56) }}>
        <DatePicker
          accessibilityLabel="Start date"
          displayValue={
            draft.startDate ? formatShortDate(draft.startDate) : "Start"
          }
          mode="date"
          onChange={(date) =>
            setDraft((current) => ({
              ...current,
              startDate: date ? dateToPlainDate(date) : null,
              startTime: date ? current.startTime : null,
            }))
          }
          placeholder="Start"
          showIcon={false}
          style={{ borderRadius: 999, minHeight: 44, paddingHorizontal: 4 }}
          value={draft.startDate ? plainDateToDate(draft.startDate) : undefined}
          valueTextStyle={{ fontSize: 13, textAlign: "center" }}
          variant="outline"
        />
      </View>
      <View style={{ width: chipWidth(70) }}>
        <DatePicker
          accessibilityLabel="Start time"
          disabled={!draft.startDate}
          displayValue={formatPlainTime(draft.startTime)}
          mode="time"
          onChange={(date) =>
            setDraft((current) => ({
              ...current,
              startTime: date ? dateToPlainTime(date) : null,
            }))
          }
          placeholder="Time"
          showIcon={false}
          style={{ borderRadius: 999, minHeight: 44, paddingHorizontal: 4 }}
          timeFormat={localeTimeFormat()}
          value={draft.startTime ? plainTimeToDate(draft.startTime) : undefined}
          valueTextStyle={{ fontSize: 13, textAlign: "center" }}
          variant="outline"
        />
      </View>

      <View className="flex-row items-center gap-1">
        <View style={{ width: chipWidth(86) }}>
          <DatePicker
            accessibilityLabel="Due date"
            displayValue={
              draft.dueDate ? `Due ${formatShortDate(draft.dueDate)}` : "Due"
            }
            mode="date"
            onChange={(date) =>
              setDraft((current) => ({
                ...current,
                dueDate: date ? dateToPlainDate(date) : null,
              }))
            }
            placeholder="Due"
            showIcon={false}
            style={{ borderRadius: 999, minHeight: 44, paddingHorizontal: 4 }}
            value={draft.dueDate ? plainDateToDate(draft.dueDate) : undefined}
            valueTextStyle={{ fontSize: 13, textAlign: "center" }}
            variant="outline"
          />
        </View>

        <Button
          accessibilityLabel="Repeat"
          accessibilityState={{ expanded: isRecurrenceExpanded }}
          accessibilityValue={{
            text: draft.recurrence ? recurrenceSummary : "None",
          }}
          onPress={onToggleRecurrence}
          size="icon"
          style={{ borderRadius: 999, height: 44, width: 44 }}
          variant={isRecurrenceExpanded ? "default" : "outline"}
        >
          <Icon
            as={Repeat2}
            className={
              isRecurrenceExpanded
                ? "text-primary-foreground"
                : "text-foreground"
            }
            size={14}
          />
        </Button>
      </View>
    </View>
  );
}

export function TaskEditorSheet({
  canSave,
  overlay,
  isSaving = false,
  isVisible,
  mode,
  draft,
  setDraft,
  onClose,
  onSave,
  onDelete,
  onToggleDone,
  series,
  timeZone,
}: TaskEditorSheetProps) {
  const { tagsQuery } = useTags();
  const { parseLink } = useTasks();
  const tags = tagsQuery.data ?? [];
  const [isRecurrenceExpanded, setIsRecurrenceExpanded] = React.useState(false);
  const [isTagPickerExpanded, setIsTagPickerExpanded] = React.useState(false);
  // Each opening starts with the repeat and tag panels folded, however the
  // last one closed (a save closes it from the flow, not from here).
  const [wasVisible, setWasVisible] = React.useState(isVisible);
  if (isVisible !== wasVisible) {
    setWasVisible(isVisible);
    if (isVisible) {
      setIsRecurrenceExpanded(false);
      setIsTagPickerExpanded(false);
    }
  }

  if (!draft) {
    return null;
  }

  const recurrenceState = getTaskRecurrenceEditorState(
    draft.recurrence,
    draft.startDate
  );
  const recurrenceSummary = getTaskRecurrenceDisplayText(draft.recurrence);
  const activeFrequency = draft.recurrence?.freq ?? "NONE";
  // Mark done saves the edits with it, so it waits on the same check.
  const canToggleDone = Boolean(mode === "edit" && onToggleDone) && canSave;
  const isDone = draft.status === "done";

  const selectedTags = tags.filter((tag) => draft.tagIds.includes(tag.id));
  const availableTags = tags.filter((tag) => !draft.tagIds.includes(tag.id));

  const addTag = (tagId: string) => {
    setDraft((current) => {
      if (current.tagIds.includes(tagId)) {
        return current;
      }
      return { ...current, tagIds: [...current.tagIds, tagId] };
    });
  };

  const removeTag = (tagId: string) => {
    setDraft((current) => ({
      ...current,
      tagIds: current.tagIds.filter((id) => id !== tagId),
    }));
  };

  const applyRecurrenceState = (nextState: TaskRecurrenceEditorState) => {
    setDraft((current) => ({
      ...current,
      recurrence: buildTaskRecurrence(nextState),
    }));
  };

  const updateRecurrence = (patch: Partial<TaskRecurrenceEditorState>) => {
    applyRecurrenceState({
      ...recurrenceState,
      ...patch,
    });
  };

  const handleSelectFrequency = (
    frequency: TaskRecurrenceFrequency | "NONE"
  ) => {
    if (frequency === "NONE") {
      setDraft((current) => ({ ...current, recurrence: null }));
      return;
    }

    applyRecurrenceState({
      ...recurrenceState,
      freq: frequency,
    });
  };

  const handleClose = () => {
    // While a save runs, the editor holds: closing would drop the edits if
    // the save fails.
    if (isSaving) {
      return;
    }
    onClose();
  };

  const fallbackUntil = draft.startDate ?? Temporal.Now.plainDateISO(timeZone);

  return (
    <BottomSheet
      disablePanGesture={isSaving}
      enableBackdropDismiss={!isSaving}
      headerRight={
        <TaskEditorHeaderActions
          canSave={canSave}
          isSaving={isSaving}
          onDelete={mode === "edit" ? onDelete : undefined}
          onSave={onSave}
        />
      }
      isVisible={isVisible}
      onClose={handleClose}
      snapPoints={[0.84, 0.95, 0.99]}
      title={mode === "edit" ? "Edit task" : "New task"}
    >
      {/* While a save runs, the fields are read-only, to touch and to
          VoiceOver alike: a change made then would be dropped when the
          editor closes. */}
      <View
        accessibilityElementsHidden={isSaving}
        importantForAccessibility={isSaving ? "no-hide-descendants" : "auto"}
        pointerEvents={isSaving ? "none" : "auto"}
        style={isSaving ? { opacity: 0.6 } : undefined}
      >
        <TaskScheduleChips
          draft={draft}
          isRecurrenceExpanded={isRecurrenceExpanded}
          onToggleRecurrence={() =>
            setIsRecurrenceExpanded((current) => !current)
          }
          recurrenceSummary={recurrenceSummary}
          setDraft={setDraft}
        />

        {isRecurrenceExpanded ? (
          <TaskRecurrenceEditor
            activeFrequency={activeFrequency}
            fallbackUntil={fallbackUntil}
            handleSelectFrequency={handleSelectFrequency}
            hasRecurrence={draft.recurrence !== null}
            recurrenceState={recurrenceState}
            recurrenceSummary={recurrenceSummary}
            updateRecurrence={updateRecurrence}
          />
        ) : null}
        <RepeatNote
          note={repeatNote({
            isRecurring: series !== null,
            next: draft.recurrence,
            previous: series?.recurrence ?? null,
            startDate: draft.startDate,
            undatedMember: series?.undated ?? false,
          })}
        />

        <View className="mb-2.5 flex-row items-center gap-2">
          <Checkbox
            accessibilityLabel="Done"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isDone, disabled: !canToggleDone }}
            checked={isDone}
            disabled={!canToggleDone}
            // 36 by 26pt. The slop makes 44pt, all inside the row (iOS clips
            // slop at the parent's edge): up and down, and right into the gap.
            hitSlop={{ bottom: 9, right: 8, top: 9 }}
            onCheckedChange={(checked) =>
              onToggleDone?.(checked ? "done" : "todo")
            }
            style={{
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 0,
              width: 36,
            }}
          />
          <Input
            accessibilityLabel="Title"
            containerStyle={{ flex: 1 }}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, title: value }))
            }
            pill
            placeholder="Title"
            value={draft.title}
            variant="outline"
          />
        </View>

        <TaskTagPicker
          availableTags={availableTags}
          isExpanded={isTagPickerExpanded}
          onAdd={addTag}
          onRemove={removeTag}
          onToggleExpanded={() => setIsTagPickerExpanded((current) => !current)}
          selectedTags={selectedTags}
        />

        <Textarea
          accessibilityLabel="Description"
          containerStyle={{ marginBottom: 10 }}
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, description: value }))
          }
          placeholder="Description"
          value={draft.description}
          variant="outline"
        />

        <NativeLinkListEditor
          isParsing={parseLink.isPending}
          linkInput={draft.linkInput}
          links={draft.links}
          onAddLink={(url) => {
            const isFirstLink = draft.links.length === 0;

            // Insert placeholder immediately so the link survives a quick save
            setDraft((current) => ({
              ...current,
              linkInput: "",
              links: dedupeLinks([
                ...current.links,
                {
                  fetchedAt: new Date().toISOString(),
                  provider: "unknown" as const,
                  url,
                },
              ]),
            }));

            parseLink.mutate(url, {
              onSuccess: (meta) => {
                setDraft((current) => {
                  const next = {
                    ...current,
                    links: dedupeLinks(
                      current.links.map((l) => (l.url === url ? meta : l))
                    ),
                  };
                  if (isFirstLink) {
                    if (meta.title && !current.title.trim()) {
                      next.title = meta.title;
                    }
                    if ("durationSeconds" in meta && meta.durationSeconds > 0) {
                      next.durationMinutes = Math.ceil(
                        meta.durationSeconds / 60
                      );
                    }
                  }
                  return next;
                });
              },
            });
          }}
          onLinkInputChange={(value) =>
            setDraft((current) => ({ ...current, linkInput: value }))
          }
          onRemoveLink={(index) =>
            setDraft((current) => ({
              ...current,
              links: current.links.filter((_, i) => i !== index),
            }))
          }
        />
      </View>
      {overlay}
    </BottomSheet>
  );
}

/**
 * An http(s) address the URL parser accepts too: the pattern alone lets
 * through "https://host:abc", whose hostname the title fallback reads.
 */
function isWebUrl(text: string): boolean {
  if (!URL_REGEX.test(text)) {
    return false;
  }
  try {
    return new URL(text).hostname.length > 0;
  } catch {
    return false;
  }
}

function NativeLinkListEditor({
  links,
  linkInput,
  isParsing,
  onAddLink,
  onRemoveLink,
  onLinkInputChange,
}: {
  isParsing: boolean;
  linkInput: string;
  links: LinkMeta[];
  onAddLink: (url: string) => void;
  onLinkInputChange: (value: string) => void;
  onRemoveLink: (index: number) => void;
}) {
  const submitUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    if (!isWebUrl(trimmed)) {
      return;
    }
    if (links.some((l) => l.url === trimmed)) {
      onLinkInputChange("");
      return;
    }
    onAddLink(trimmed);
  };

  return (
    <>
      {links.map((meta, index) => (
        <View
          className="mb-1.5 flex-row items-start gap-2 rounded-md border border-border px-3 py-2.5"
          key={meta.url}
        >
          {meta.thumbnailUrl ? (
            <Pressable onPress={() => Linking.openURL(meta.url)}>
              <Image
                source={{ uri: meta.thumbnailUrl }}
                style={{ borderRadius: 4, height: 40, width: 40 }}
              />
            </Pressable>
          ) : null}
          <Pressable
            className="min-w-0 flex-1"
            onPress={() => Linking.openURL(meta.url)}
          >
            <Text
              className="font-semibold text-foreground text-sm"
              numberOfLines={1}
            >
              {meta.title ?? "Untitled"}
            </Text>
            <Text className="mt-0.5 text-muted-foreground text-xs">
              {getProviderLabel(meta.provider)}
              {(() => {
                const dur = getLinkDurationMinutes(meta);
                return dur === null ? "" : ` · ${dur}m`;
              })()}
              {(() => {
                const wc = getLinkWordCount(meta);
                return wc === null ? "" : ` · ${wc.toLocaleString()} words`;
              })()}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`Remove link ${meta.title ?? meta.url}`}
            accessibilityRole="button"
            hitSlop={14}
            onPress={() => onRemoveLink(index)}
            style={{ paddingTop: 2 }}
          >
            <Icon as={XCircle} className="text-muted-foreground" size={16} />
          </Pressable>
        </View>
      ))}

      <View className="mb-2.5 flex-row items-center gap-2">
        <View
          style={{ alignItems: "center", justifyContent: "center", width: 36 }}
        >
          {isParsing ? (
            <Icon as={Loader2} className="text-muted-foreground" size={16} />
          ) : (
            <Icon as={Link2} className="text-muted-foreground" size={16} />
          )}
        </View>
        <Input
          accessibilityLabel="Add link"
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={{ flex: 1 }}
          keyboardType="url"
          onBlur={() => submitUrl(linkInput)}
          onChangeText={onLinkInputChange}
          pill
          placeholder="https://..."
          value={linkInput}
          variant="outline"
        />
      </View>
    </>
  );
}
