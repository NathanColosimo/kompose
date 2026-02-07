import type { TagSelect } from "@kompose/api/routers/tag/contract";
import type { TaskRecurrence } from "@kompose/api/routers/task/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import {
  buildTaskRecurrence,
  getTaskRecurrenceDisplayText,
  getTaskRecurrenceEditorState,
  getTaskRecurrenceIntervalLabel,
  TASK_RECURRENCE_DAYS,
  type TaskRecurrenceEditorState,
  type TaskRecurrenceFrequency,
  toggleTaskRecurrenceDay,
} from "@kompose/state/task-recurrence";
import { Check, Minus, Plus, Repeat2, Trash2 } from "lucide-react-native";
import React from "react";
import { Pressable, View } from "react-native";
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

export interface TaskDraft {
  title: string;
  description: string;
  tagIds: string[];
  durationMinutes: number;
  status: "todo" | "in_progress" | "done";
  dueDate: Temporal.PlainDate | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
  recurrence: TaskRecurrence | null;
}

interface TaskEditorSheetProps {
  isVisible: boolean;
  mode: "create" | "edit";
  draft: TaskDraft | null;
  setDraft: (updater: (previous: TaskDraft) => TaskDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onToggleDone?: (nextStatus: TaskDraft["status"]) => void;
  timeZone: string;
  title?: string;
  snapPoints?: number[];
}

const DURATION_MINUTE_OPTIONS = [0, 15, 30, 45];
const RECURRENCE_FREQUENCIES: Array<{
  value: TaskRecurrenceFrequency | "NONE";
  label: string;
}> = [
  { value: "NONE", label: "None" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

function plainDateToDate(plainDate: Temporal.PlainDate): Date {
  return new Date(plainDate.year, plainDate.month - 1, plainDate.day);
}

function plainTimeToDate(plainTime: Temporal.PlainTime): Date {
  const date = new Date();
  date.setHours(plainTime.hour, plainTime.minute, 0, 0);
  return date;
}

function dateToPlainDate(date: Date, _timeZone: string): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

function dateToPlainTime(date: Date, _timeZone: string): Temporal.PlainTime {
  return Temporal.PlainTime.from({
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: 0,
  });
}

function formatPlainDateShort(date: Temporal.PlainDate | null): string {
  if (!date) {
    return "Not set";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(plainDateToDate(date));
}

function formatPlainTime24(time: Temporal.PlainTime | null): string {
  if (!time) {
    return "--:--";
  }
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

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

export function TaskEditorSheet({
  isVisible,
  mode,
  draft,
  setDraft,
  onClose,
  onSave,
  onDelete,
  onToggleDone,
  timeZone,
  title,
  snapPoints = [0.84, 0.95, 0.99],
}: TaskEditorSheetProps) {
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];
  const [isRecurrenceExpanded, setIsRecurrenceExpanded] = React.useState(false);
  const [isTagPickerExpanded, setIsTagPickerExpanded] = React.useState(false);
  const canSave = draft ? draft.title.trim().length > 0 : false;

  if (!draft) {
    return null;
  }

  const durationOptions = Array.from({ length: 24 }, (_, hour) =>
    DURATION_MINUTE_OPTIONS.map((minute) => {
      const totalMinutes = hour * 60 + minute;
      return {
        label: formatDurationMinutes(totalMinutes),
        value: String(totalMinutes),
      };
    })
  ).flat();

  const recurrenceState = getTaskRecurrenceEditorState(
    draft.recurrence,
    draft.startDate
  );
  const recurrenceSummary = getTaskRecurrenceDisplayText(draft.recurrence);
  const activeFrequency = draft.recurrence?.freq ?? "NONE";
  const canToggleDone = Boolean(mode === "edit" && onToggleDone);
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
    setIsRecurrenceExpanded(false);
    setIsTagPickerExpanded(false);
    onClose();
  };

  const fallbackUntil = draft.startDate ?? Temporal.Now.plainDateISO(timeZone);

  const renderTagPill = (tag: TagSelect, action: "add" | "remove") => {
    const TagIcon = tagIconMap[tag.icon];
    const actionIcon = action === "add" ? Plus : Minus;

    return (
      <Pressable
        className="rounded-full border border-border px-2.5 py-1.5"
        key={`${action}-${tag.id}`}
        onPress={() => (action === "add" ? addTag(tag.id) : removeTag(tag.id))}
      >
        <View className="flex-row items-center gap-1.5">
          <Icon as={TagIcon} className="text-muted-foreground" size={12} />
          <Text className="text-foreground text-xs">{tag.name}</Text>
          <Icon as={actionIcon} className="text-muted-foreground" size={12} />
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <BottomSheet
        headerRight={
          <View className="flex-row items-center gap-2">
            {mode === "edit" && onDelete ? (
              <Button
                onPress={onDelete}
                size="icon"
                style={{ borderRadius: 999 }}
                variant="ghost"
              >
                <Icon as={Trash2} className="text-red-500" size={18} />
              </Button>
            ) : null}
            <Button
              disabled={!canSave}
              onPress={onSave}
              size="icon"
              style={{ borderRadius: 999 }}
              variant="ghost"
            >
              <Icon
                as={Check}
                className={canSave ? "text-green-500" : "text-muted-foreground"}
                size={18}
              />
            </Button>
          </View>
        }
        isVisible={isVisible}
        onClose={handleClose}
        snapPoints={snapPoints}
        title={title ?? (mode === "edit" ? "Edit task" : "New task")}
      >
        <View className="mb-3 flex-row items-center gap-1.5">
          <View style={{ width: 86 }}>
            <Picker
              inputStyle={{ textAlign: "center" }}
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
              options={durationOptions}
              placeholder="Duration"
              showChevron={false}
              style={{ borderRadius: 999, minHeight: 38, paddingHorizontal: 0 }}
              value={String(draft.durationMinutes)}
              variant="outline"
            />
          </View>

          <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
            <View className="min-w-0 flex-1">
              <DatePicker
                displayValue={
                  draft.startDate
                    ? formatPlainDateShort(draft.startDate)
                    : "Start"
                }
                mode="date"
                onChange={(date) =>
                  setDraft((current) => ({
                    ...current,
                    startDate: date ? dateToPlainDate(date, timeZone) : null,
                    startTime: date ? current.startTime : null,
                  }))
                }
                placeholder="Start"
                showIcon={false}
                style={{
                  borderRadius: 999,
                  minHeight: 38,
                  paddingHorizontal: 4,
                }}
                value={
                  draft.startDate ? plainDateToDate(draft.startDate) : undefined
                }
                valueTextStyle={{ fontSize: 13, textAlign: "center" }}
                variant="outline"
              />
            </View>
            <View style={{ width: 74 }}>
              <DatePicker
                disabled={!draft.startDate}
                displayValue={formatPlainTime24(draft.startTime)}
                mode="time"
                onChange={(date) =>
                  setDraft((current) => ({
                    ...current,
                    startTime: date ? dateToPlainTime(date, timeZone) : null,
                  }))
                }
                placeholder="--:--"
                showIcon={false}
                style={{
                  borderRadius: 999,
                  minHeight: 38,
                  paddingHorizontal: 4,
                }}
                timeFormat="24"
                value={
                  draft.startTime ? plainTimeToDate(draft.startTime) : undefined
                }
                valueTextStyle={{ fontSize: 13, textAlign: "center" }}
                variant="outline"
              />
            </View>
          </View>

          <View style={{ width: 86 }}>
            <DatePicker
              displayValue={
                draft.dueDate ? formatPlainDateShort(draft.dueDate) : "Due"
              }
              mode="date"
              onChange={(date) =>
                setDraft((current) => ({
                  ...current,
                  dueDate: date ? dateToPlainDate(date, timeZone) : null,
                }))
              }
              placeholder="Due"
              showIcon={false}
              style={{ borderRadius: 999, minHeight: 38, paddingHorizontal: 4 }}
              value={draft.dueDate ? plainDateToDate(draft.dueDate) : undefined}
              valueTextStyle={{ fontSize: 13, textAlign: "center" }}
              variant="outline"
            />
          </View>

          <Button
            onPress={() => setIsRecurrenceExpanded((current) => !current)}
            size="icon"
            style={{ borderRadius: 999, height: 38, width: 38 }}
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

        {isRecurrenceExpanded ? (
          <View className="mb-2.5 rounded-md border border-border px-3 py-3">
            <Text className="font-semibold text-foreground text-sm">
              Repeat
            </Text>
            <Text className="mt-0.5 text-muted-foreground text-xs">
              {recurrenceSummary}
            </Text>

            <View className="mt-2 flex-row flex-wrap gap-2">
              {RECURRENCE_FREQUENCIES.map((frequency) => {
                const active = activeFrequency === frequency.value;
                return (
                  <Button
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

            {draft.recurrence ? (
              <>
                <View className="mt-3 flex-row items-center gap-2">
                  <Text className="text-muted-foreground text-xs">Every</Text>
                  <Input
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
                    <Text className="text-muted-foreground text-xs">
                      On days
                    </Text>
                    <View className="mt-1 flex-row flex-wrap gap-2">
                      {TASK_RECURRENCE_DAYS.map((day) => {
                        const selected = recurrenceState.byDay.includes(
                          day.value
                        );
                        return (
                          <Button
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
                    <Text className="text-muted-foreground text-xs">
                      On day
                    </Text>
                    <Input
                      containerStyle={{ width: 78 }}
                      inputStyle={{ fontSize: 13 }}
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

                <View className="mt-3">
                  <Text className="text-muted-foreground text-xs">Ends</Text>
                  <View className="mt-1 flex-row flex-wrap gap-2">
                    <Button
                      onPress={() =>
                        updateRecurrence({ endType: "never", until: null })
                      }
                      size="sm"
                      style={{ borderRadius: 999 }}
                      variant={
                        recurrenceState.endType === "never"
                          ? "default"
                          : "outline"
                      }
                    >
                      <Text>Never</Text>
                    </Button>
                    <Button
                      onPress={() =>
                        updateRecurrence({
                          endType: "until",
                          until: recurrenceState.until ?? fallbackUntil,
                        })
                      }
                      size="sm"
                      style={{ borderRadius: 999 }}
                      variant={
                        recurrenceState.endType === "until"
                          ? "default"
                          : "outline"
                      }
                    >
                      <Text>On date</Text>
                    </Button>
                    <Button
                      onPress={() =>
                        updateRecurrence({
                          endType: "count",
                          count:
                            Number.isFinite(recurrenceState.count) &&
                            recurrenceState.count > 0
                              ? recurrenceState.count
                              : 10,
                        })
                      }
                      size="sm"
                      style={{ borderRadius: 999 }}
                      variant={
                        recurrenceState.endType === "count"
                          ? "default"
                          : "outline"
                      }
                    >
                      <Text>After N</Text>
                    </Button>
                  </View>

                  {recurrenceState.endType === "until" ? (
                    <View className="mt-2" style={{ maxWidth: 220 }}>
                      <DatePicker
                        displayValue={
                          recurrenceState.until
                            ? formatPlainDateShort(recurrenceState.until)
                            : "Until date"
                        }
                        mode="date"
                        onChange={(date) =>
                          updateRecurrence({
                            until: date
                              ? dateToPlainDate(date, timeZone)
                              : null,
                          })
                        }
                        placeholder="Until date"
                        showIcon={false}
                        style={{
                          borderRadius: 999,
                          minHeight: 38,
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
                      <Text className="text-foreground text-xs">
                        occurrences
                      </Text>
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <View className="mb-2.5 flex-row items-center gap-2">
          <Checkbox
            checked={isDone}
            disabled={!canToggleDone}
            onCheckedChange={(checked) => {
              if (canToggleDone) {
                const nextStatus: TaskDraft["status"] = checked
                  ? "done"
                  : "todo";
                setDraft((current) => ({ ...current, status: nextStatus }));
                onToggleDone?.(nextStatus);
              }
            }}
            style={{
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 0,
              width: 36,
            }}
          />
          <Input
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

        <View className="mb-2.5 rounded-md border border-border px-3 py-2.5">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-foreground text-sm">Tags</Text>
            <Button
              onPress={() => setIsTagPickerExpanded((current) => !current)}
              size="icon"
              style={{ borderRadius: 999, height: 30, width: 30 }}
              variant="ghost"
            >
              <Icon as={Plus} className="text-foreground" size={14} />
            </Button>
          </View>

          <View className="mt-2 flex-row flex-wrap gap-2">
            {selectedTags.length > 0 ? (
              selectedTags.map((tag) => renderTagPill(tag, "remove"))
            ) : (
              <Text className="text-muted-foreground text-xs">
                No tags selected
              </Text>
            )}
          </View>

          {isTagPickerExpanded ? (
            <>
              <View className="mt-2 border-border border-t" />
              <View className="mt-2 flex-row flex-wrap gap-2">
                {availableTags.length > 0 ? (
                  availableTags.map((tag) => renderTagPill(tag, "add"))
                ) : (
                  <Text className="text-muted-foreground text-xs">
                    All tags selected
                  </Text>
                )}
              </View>
            </>
          ) : null}
        </View>

        <Textarea
          containerStyle={{ marginBottom: 10 }}
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, description: value }))
          }
          placeholder="Description"
          value={draft.description}
          variant="outline"
        />
      </BottomSheet>
    </>
  );
}
