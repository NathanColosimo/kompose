import { Picker } from "@react-native-picker/picker";
import { X } from "lucide-react-native";
import React from "react";
import { View } from "react-native";
import { Temporal } from "temporal-polyfill";
import { TagPicker } from "@/components/tags/tag-picker";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { useColorScheme } from "@/lib/color-scheme-context";

export interface TaskDraft {
  title: string;
  description: string;
  tagIds: string[];
  durationMinutes: number;
  dueDate: Temporal.PlainDate | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
}

interface TaskEditorSheetProps {
  isVisible: boolean;
  mode: "create" | "edit";
  draft: TaskDraft | null;
  setDraft: (updater: (previous: TaskDraft) => TaskDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onToggleDone?: () => void;
  status?: "todo" | "in_progress" | "done" | null;
  timeZone: string;
  title?: string;
  snapPoints?: number[];
}

const DURATION_HOUR_OPTIONS = Array.from({ length: 6 }, (_, index) => index);
const DURATION_MINUTE_OPTIONS = [0, 15, 30, 45];

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
  status,
  timeZone,
  title,
  snapPoints = [0.84, 0.95, 0.99],
}: TaskEditorSheetProps) {
  const { isDarkColorScheme } = useColorScheme();
  const pickerTextColor = isDarkColorScheme ? "#fafafa" : "#0a0a0a";
  const [isDurationPickerOpen, setIsDurationPickerOpen] = React.useState(false);
  const canSave = draft ? draft.title.trim().length > 0 : false;

  if (!draft) {
    return null;
  }

  const durationHours = Math.min(Math.floor(draft.durationMinutes / 60), 5);
  const durationMinutes = draft.durationMinutes % 60;
  const durationMinuteValue = DURATION_MINUTE_OPTIONS.includes(durationMinutes)
    ? durationMinutes
    : 0;

  const handleClose = () => {
    setIsDurationPickerOpen(false);
    onClose();
  };

  return (
    <>
      <BottomSheet
        headerRight={
          <Button disabled={!canSave} onPress={onSave}>
            <Text>Save</Text>
          </Button>
        }
        isVisible={isVisible}
        onClose={handleClose}
        snapPoints={snapPoints}
        title={title ?? (mode === "edit" ? "Edit task" : "New task")}
      >
        <Input
          containerStyle={{ marginBottom: 12 }}
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, title: value }))
          }
          placeholder="Title"
          variant="outline"
          value={draft.title}
        />

        <Textarea
          containerStyle={{ marginBottom: 12 }}
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, description: value }))
          }
          placeholder="Description"
          variant="outline"
          value={draft.description}
        />

        <React.Fragment>
          <Text className="mb-2 font-semibold text-foreground text-sm">
            Tags
          </Text>
          <TagPicker
            onChange={(nextTagIds) =>
              setDraft((current) => ({ ...current, tagIds: nextTagIds }))
            }
            value={draft.tagIds}
          />
        </React.Fragment>

        <React.Fragment>
          <View className="mt-3 mb-3 flex-row items-center gap-2">
            <Text className="font-semibold text-foreground text-sm">
              Duration
            </Text>
            <Button onPress={() => setIsDurationPickerOpen(true)} variant="outline">
              <Text>{formatDurationMinutes(draft.durationMinutes)}</Text>
            </Button>
          </View>
        </React.Fragment>

        <View className="mb-2 rounded-md border border-border px-3 py-2.5">
          <Text className="text-muted-foreground text-xs">Dates & Time</Text>
          <Text className="mt-1 text-foreground text-sm">
            Due {formatPlainDateShort(draft.dueDate)}
          </Text>
          <Text className="mt-0.5 text-foreground text-sm">
            Start {formatPlainDateShort(draft.startDate)} {formatPlainTime24(draft.startTime)}
          </Text>
        </View>

        <View className="mb-2.5">
          <Text className="text-muted-foreground text-xs">Due date</Text>
          <View className="mt-1 flex-row items-center gap-2">
            <View style={{ flex: 1 }}>
              <DatePicker
                mode="date"
                onChange={(date) =>
                  setDraft((current) => ({
                    ...current,
                    dueDate: date ? dateToPlainDate(date, timeZone) : null,
                  }))
                }
                placeholder="Due date"
                value={
                  draft.dueDate ? plainDateToDate(draft.dueDate) : undefined
                }
                variant="outline"
              />
            </View>
            {draft.dueDate ? (
              <Button
                accessibilityLabel="Clear due date"
                onPress={() =>
                  setDraft((current) => ({ ...current, dueDate: null }))
                }
                size="icon"
                variant="ghost"
              >
                <Icon as={X} size={16} />
              </Button>
            ) : null}
          </View>
        </View>

        <View className="mb-2.5">
          <Text className="text-muted-foreground text-xs">Start date</Text>
          <View className="mt-1 flex-row items-center gap-2">
            <View style={{ flex: 1 }}>
              <DatePicker
                mode="date"
                onChange={(date) =>
                  setDraft((current) => ({
                    ...current,
                    startDate: date ? dateToPlainDate(date, timeZone) : null,
                    startTime: date ? current.startTime : null,
                  }))
                }
                placeholder="Start date"
                value={
                  draft.startDate ? plainDateToDate(draft.startDate) : undefined
                }
                variant="outline"
              />
            </View>
            {draft.startDate ? (
              <Button
                accessibilityLabel="Clear start date"
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    startDate: null,
                    startTime: null,
                  }))
                }
                size="icon"
                variant="ghost"
              >
                <Icon as={X} size={16} />
              </Button>
            ) : null}
          </View>
        </View>

        <View className="mb-2.5">
          <Text className="text-muted-foreground text-xs">Start time</Text>
          <View className="mt-1 flex-row items-center gap-2">
            <View style={{ flex: 1 }}>
              <DatePicker
                disabled={!draft.startDate}
                mode="time"
                onChange={(date) =>
                  setDraft((current) => ({
                    ...current,
                    startTime: date ? dateToPlainTime(date, timeZone) : null,
                  }))
                }
                placeholder="Start time"
                timeFormat="24"
                value={
                  draft.startTime ? plainTimeToDate(draft.startTime) : undefined
                }
                variant="outline"
              />
            </View>
            {draft.startTime ? (
              <Button
                accessibilityLabel="Clear start time"
                onPress={() =>
                  setDraft((current) => ({ ...current, startTime: null }))
                }
                size="icon"
                variant="ghost"
              >
                <Icon as={X} size={16} />
              </Button>
            ) : null}
          </View>
        </View>

        <View className="mt-2 mb-6 flex-row items-center justify-end gap-2.5">
          {mode === "edit" && onToggleDone && status ? (
            <Button onPress={onToggleDone} variant="outline">
              <Text>{status === "done" ? "Mark todo" : "Mark done"}</Text>
            </Button>
          ) : null}

          {mode === "edit" && onDelete ? (
            <Button onPress={onDelete} variant="destructive">
              <Text>Delete</Text>
            </Button>
          ) : null}
        </View>
      </BottomSheet>

      <BottomSheet
        isVisible={isDurationPickerOpen}
        onClose={() => setIsDurationPickerOpen(false)}
        snapPoints={[0.4, 0.55]}
        title="Duration"
      >
        <View className="flex-row items-center gap-4">
          <View className="flex-1">
            <Text className="text-muted-foreground text-xs">Hours</Text>
            <Picker
              dropdownIconColor={pickerTextColor}
              onValueChange={(value: number) => {
                const nextMinutes = value * 60 + durationMinuteValue;
                setDraft((current) => ({
                  ...current,
                  durationMinutes: nextMinutes,
                }));
              }}
              selectedValue={durationHours}
              style={{ color: pickerTextColor }}
            >
              {DURATION_HOUR_OPTIONS.map((value) => (
                <Picker.Item key={value} label={`${value}h`} value={value} />
              ))}
            </Picker>
          </View>
          <View className="flex-1">
            <Text className="text-muted-foreground text-xs">Minutes</Text>
            <Picker
              dropdownIconColor={pickerTextColor}
              onValueChange={(value: number) => {
                const nextMinutes = durationHours * 60 + value;
                setDraft((current) => ({
                  ...current,
                  durationMinutes: nextMinutes,
                }));
              }}
              selectedValue={durationMinuteValue}
              style={{ color: pickerTextColor }}
            >
              {DURATION_MINUTE_OPTIONS.map((value) => (
                <Picker.Item
                  key={value}
                  label={`${String(value).padStart(2, "0")}m`}
                  value={value}
                />
              ))}
            </Picker>
          </View>
        </View>
      </BottomSheet>
    </>
  );
}
