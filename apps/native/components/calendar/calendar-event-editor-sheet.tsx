import type { LocationSuggestion } from "@kompose/api/routers/maps/contract";
import {
  canWriteCalendar,
  type Event as GoogleEvent,
  getGoogleEventEditBlockReason,
} from "@kompose/google-cal/schema";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@kompose/state/atoms/google-colors";
import {
  buildGoogleEventRecurrenceRule,
  dateToUntilRule,
  describeEventRecurrence,
  type EventRecurrenceEnd,
  type EventRecurrenceFrequency,
  GOOGLE_EVENT_WEEKDAYS,
  getPrimaryRecurrenceRule,
  parseGoogleEventRecurrenceRule,
  setPrimaryRecurrenceRule,
  untilRuleToDate,
} from "@kompose/state/google-event-recurrence";
import { useLocationSearch } from "@kompose/state/hooks/use-location-search";
import { getMapsSearchUrl } from "@kompose/state/locations";
import {
  buildGoogleMeetConferenceData,
  extractMeetingLink,
  type MeetingLink,
} from "@kompose/state/meeting";
import {
  formatAllDayWhen,
  formatEventWhen,
  moveEventStart,
} from "@kompose/state/temporal-utils";
import { useAtomValue } from "jotai";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  MapPin,
  Repeat2,
  Trash2,
  Video,
  X,
} from "lucide-react-native";
import React from "react";
import {
  type UseFormGetValues,
  type UseFormSetValue,
  useForm,
} from "react-hook-form";
import { Linking, Pressable, Switch as RNSwitch, View } from "react-native";
import { Temporal } from "temporal-polyfill";
import type {
  CalendarOption,
  EditEventDraft,
  EventDraft,
} from "@/components/calendar/calendar-editor-types";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { useColor } from "@/hooks/use-color";
import { localeTimeFormat } from "@/lib/time-format";

const RECURRENCE_FREQUENCIES: Array<{
  value: EventRecurrenceFrequency;
  label: string;
}> = [
  { label: "None", value: "none" },
  { label: "Daily", value: "DAILY" },
  { label: "Weekly", value: "WEEKLY" },
  { label: "Monthly", value: "MONTHLY" },
  { label: "Yearly", value: "YEARLY" },
];

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

function plainDateToPickerDate(date: Temporal.PlainDate): Date {
  return new Date(date.year, date.month - 1, date.day);
}

function plainTimeToPickerDate(time: Temporal.PlainTime): Date {
  const value = new Date();
  value.setHours(time.hour, time.minute, 0, 0);
  return value;
}

function formatPlainDateCompact(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(plainDateToPickerDate(date));
}

function toCalendarOptionValue(option: {
  accountId: string;
  calendarId: string;
}): string {
  return `${option.accountId}::${option.calendarId}`;
}

function findCalendarOptionByValue(
  value: string,
  calendarOptions: CalendarOption[]
): CalendarOption | undefined {
  return calendarOptions.find(
    (option) => toCalendarOptionValue(option) === value
  );
}

function buildRecurrenceRuleFromCurrent(
  currentRule: string | undefined,
  patch: {
    freq?: EventRecurrenceFrequency;
    byDay?: string[];
    end?: EventRecurrenceEnd;
  }
): string | null {
  const parsed = parseGoogleEventRecurrenceRule(currentRule);
  const freq = patch.freq ?? parsed.freq;
  const byDay = patch.byDay ?? parsed.byDay;
  const end = patch.end ?? parsed.end;
  return buildGoogleEventRecurrenceRule(freq, byDay, end);
}

/**
 * The Repeat row under the times: how the event repeats, in words, and a
 * tap opens the editor below it. Its own full-width row keeps the date and
 * time pills above it the same widths.
 */
function RecurrenceRow({
  disabled,
  isExpanded,
  onToggle,
  recurrence,
  ...editor
}: React.ComponentProps<typeof RecurrenceEditorSection> & {
  /** The occurrence's pattern is still loading. */
  disabled: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  recurrence: string[];
}) {
  const repeats =
    describeEventRecurrence({
      rules: recurrence,
      startWeekday: editor.startDate.dayOfWeek,
    }) ?? "Doesn't repeat";
  return (
    <>
      <Pressable
        accessibilityLabel="Repeat"
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: isExpanded }}
        accessibilityValue={{ text: repeats }}
        className="mb-2.5 min-h-[38px] flex-row items-center gap-2 rounded-full border border-border px-3"
        disabled={disabled}
        onPress={onToggle}
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        <Icon as={Repeat2} className="text-muted-foreground" size={14} />
        <Text className="flex-1 text-[13px] text-foreground" numberOfLines={1}>
          {repeats}
        </Text>
        <Icon
          as={isExpanded ? ChevronUp : ChevronDown}
          className="text-muted-foreground"
          size={14}
        />
      </Pressable>
      {isExpanded ? <RecurrenceEditorSection {...editor} /> : null}
    </>
  );
}

const RRULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function RecurrenceEditorSection({
  parsedRecurrence,
  startDate,
  updateRecurrence,
  applyPrimaryRecurrenceRule,
}: {
  parsedRecurrence: ReturnType<typeof parseGoogleEventRecurrenceRule>;
  /** Its weekday is the one a weekly series repeats on by default. */
  startDate: Temporal.PlainDate;
  updateRecurrence: (patch: {
    freq?: EventRecurrenceFrequency;
    byDay?: string[];
    end?: EventRecurrenceEnd;
  }) => void;
  applyPrimaryRecurrenceRule: (rule: string | null) => void;
}) {
  // With no days picked, a weekly series repeats on the start's weekday.
  const shownDays =
    parsedRecurrence.byDay.length > 0
      ? parsedRecurrence.byDay
      : [RRULE_WEEKDAYS[startDate.dayOfWeek - 1] ?? "MO"];
  return (
    <View className="mb-2.5 rounded-md border border-border px-3 py-2.5">
      {/* Five equal chips in one row. */}
      <View className="flex-row gap-1.5">
        {RECURRENCE_FREQUENCIES.map((frequency) => {
          const active = parsedRecurrence.freq === frequency.value;
          return (
            <Button
              key={frequency.value}
              onPress={() => {
                if (frequency.value === "none") {
                  applyPrimaryRecurrenceRule(null);
                  return;
                }

                // Weekly with no days picked repeats on the start's weekday
                // (no BYDAY), so moving the start moves the series with it.
                const byDay =
                  frequency.value === "WEEKLY" ? parsedRecurrence.byDay : [];
                updateRecurrence({ byDay, freq: frequency.value });
              }}
              size="sm"
              style={CHIP_STYLE}
              variant={active ? "default" : "outline"}
            >
              <ChipLabel>{frequency.label}</ChipLabel>
            </Button>
          );
        })}
      </View>

      {parsedRecurrence.freq === "WEEKLY" ? (
        <View className="mt-3">
          <Text className="text-muted-foreground text-xs">On days</Text>
          {/* Seven equal circles in one row. */}
          <View className="mt-1 flex-row gap-1.5">
            {GOOGLE_EVENT_WEEKDAYS.map((weekday) => {
              const selected = shownDays.includes(weekday.value);
              return (
                <Button
                  accessibilityLabel={weekday.label}
                  accessibilityState={{ selected }}
                  key={weekday.value}
                  onPress={() => {
                    const nextByDay = selected
                      ? shownDays.filter((value) => value !== weekday.value)
                      : [...shownDays, weekday.value];
                    updateRecurrence({ byDay: nextByDay });
                  }}
                  size="sm"
                  style={{
                    borderRadius: 999,
                    flex: 1,
                    height: 36,
                    paddingHorizontal: 0,
                  }}
                  variant={selected ? "default" : "outline"}
                >
                  <Text>{weekday.label.slice(0, 1)}</Text>
                </Button>
              );
            })}
          </View>
        </View>
      ) : null}

      {parsedRecurrence.freq === "none" ? null : (
        <RecurrenceEndSection
          parsedRecurrence={parsedRecurrence}
          updateRecurrence={updateRecurrence}
        />
      )}
    </View>
  );
}

const CHIP_STYLE = { borderRadius: 999, flex: 1, paddingHorizontal: 2 };

/**
 * A repeat chip's label: one size for every chip (13pt fits "Monthly" in a
 * fifth of a 375pt sheet), shrinking only for a large text size.
 */
function ChipLabel({ children }: { children: string }) {
  return (
    <Text
      adjustsFontSizeToFit
      className="text-[13px]"
      minimumFontScale={0.75}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

function RecurrenceEndSection({
  parsedRecurrence,
  updateRecurrence,
}: {
  parsedRecurrence: ReturnType<typeof parseGoogleEventRecurrenceRule>;
  updateRecurrence: (patch: { end?: EventRecurrenceEnd }) => void;
}) {
  return (
    <View className="mt-3">
      <Text className="text-muted-foreground text-xs">Ends</Text>
      {/* Three equal chips in one row. */}
      <View className="mt-1 flex-row gap-1.5">
        <Button
          onPress={() => updateRecurrence({ end: { type: "none" } })}
          size="sm"
          style={CHIP_STYLE}
          variant={parsedRecurrence.end.type === "none" ? "default" : "outline"}
        >
          <ChipLabel>Never</ChipLabel>
        </Button>
        <Button
          onPress={() => {
            const fallbackUntil =
              parsedRecurrence.end.type === "until"
                ? parsedRecurrence.end.date
                : (dateToUntilRule(new Date()) ?? undefined);
            updateRecurrence({
              end: fallbackUntil
                ? { date: fallbackUntil, type: "until" }
                : { type: "none" },
            });
          }}
          size="sm"
          style={CHIP_STYLE}
          variant={
            parsedRecurrence.end.type === "until" ? "default" : "outline"
          }
        >
          <ChipLabel>On date</ChipLabel>
        </Button>
        <Button
          onPress={() =>
            updateRecurrence({
              end: {
                count:
                  parsedRecurrence.end.type === "count"
                    ? parsedRecurrence.end.count
                    : 5,
                type: "count",
              },
            })
          }
          size="sm"
          style={CHIP_STYLE}
          variant={
            parsedRecurrence.end.type === "count" ? "default" : "outline"
          }
        >
          <ChipLabel>After…</ChipLabel>
        </Button>
      </View>

      {parsedRecurrence.end.type === "until" ? (
        <View className="mt-2" style={{ maxWidth: 220 }}>
          <DatePicker
            mode="datetime"
            onChange={(date) => {
              if (!date) {
                updateRecurrence({ end: { type: "none" } });
                return;
              }
              const untilRule = dateToUntilRule(date);
              updateRecurrence({
                end: untilRule
                  ? { date: untilRule, type: "until" }
                  : { type: "none" },
              });
            }}
            placeholder="Until"
            value={untilRuleToDate(parsedRecurrence.end.date) ?? undefined}
            variant="outline"
          />
        </View>
      ) : null}

      {parsedRecurrence.end.type === "count" ? (
        <View className="mt-2 flex-row items-center gap-2">
          <Input
            className="h-9 w-20"
            keyboardType="number-pad"
            onChangeText={(value) => {
              const nextCount = Number.parseInt(value, 10);
              updateRecurrence({
                end: {
                  count:
                    Number.isFinite(nextCount) && nextCount > 0 ? nextCount : 1,
                  type: "count",
                },
              });
            }}
            value={String(parsedRecurrence.end.count)}
            variant="outline"
          />
          <Text className="text-foreground text-xs">times</Text>
        </View>
      ) : null}
    </View>
  );
}

function EventMeetingButton({
  meetingLink,
  isConferencePending,
  onAddMeeting,
}: {
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
  onAddMeeting: () => void;
}) {
  if (meetingLink) {
    return (
      <Button
        onPress={() => {
          Linking.openURL(meetingLink.url).catch((err) => {
            console.warn("Failed to open meeting URL:", err);
          });
        }}
        size="sm"
        variant="outline"
      >
        <Icon as={Video} className="text-foreground" size={14} />
        <Text>Join {meetingLink.label}</Text>
      </Button>
    );
  }

  if (isConferencePending) {
    return (
      <Text className="text-right text-muted-foreground text-xs">
        Meet on save
      </Text>
    );
  }

  return (
    <Button onPress={onAddMeeting} size="sm" variant="outline">
      <Icon as={Video} className="text-foreground" size={14} />
      <Text>Add Meet</Text>
    </Button>
  );
}

/**
 * Locked, Gmail, and birthday events, and those on a calendar the user can
 * only view, can't be changed (Google rejects it), so their sheet shows
 * why, with no Save or Delete.
 */
function readOnlyReasonFor(
  draft: EventDraft,
  calendarOptions: CalendarOption[]
): string | null {
  if (draft.mode !== "edit" || !draft.sourceEvent) {
    return null;
  }
  const source = calendarOptions.find(
    (option) =>
      option.accountId === draft.sourceCalendar.accountId &&
      option.calendarId === draft.sourceCalendar.calendarId
  );
  return getGoogleEventEditBlockReason(draft.sourceEvent, source?.accessRole);
}

function noop() {
  // Intentionally empty: the sheet holds while its save runs.
}

/** The sheet's fields, dimmed and inert while its save runs. */
function HeldWhileSaving({
  children,
  isSaving,
}: {
  children: React.ReactNode;
  isSaving: boolean;
}) {
  return (
    <View
      pointerEvents={isSaving ? "none" : "auto"}
      style={isSaving ? { opacity: 0.6 } : undefined}
    >
      {children}
    </View>
  );
}

/**
 * Whether the draft doesn't end before it starts (an all-day event may be
 * one day; a timed one may be zero-length, as Google allows).
 */
function endsAfterStart(draft: EventDraft): boolean {
  if (draft.allDay || !(draft.startTime && draft.endTime)) {
    return Temporal.PlainDate.compare(draft.endDate, draft.startDate) >= 0;
  }
  return (
    Temporal.PlainDateTime.compare(
      draft.endDate.toPlainDateTime(draft.endTime),
      draft.startDate.toPlainDateTime(draft.startTime)
    ) >= 0
  );
}

/** When a read-only event happens, in words: "Thu, Nov 12 · All day". */
function describeWhen(draft: EventDraft): string {
  if (draft.allDay || !(draft.startTime && draft.endTime)) {
    return formatAllDayWhen(draft.startDate, draft.endDate);
  }
  const timeZone = Temporal.Now.timeZoneId();
  return formatEventWhen(
    draft.startDate.toZonedDateTime({ plainTime: draft.startTime, timeZone }),
    draft.endDate.toZonedDateTime({ plainTime: draft.endTime, timeZone })
  );
}

/**
 * A locked, Gmail, or birthday event, shown as a view rather than disabled
 * inputs: why it can't be edited, then what people open it for (the time,
 * joining the call, the place on a map, the notes to copy).
 */
function ReadOnlyEventView({
  calendarColor,
  calendarLabel,
  draft,
  mapsUrl,
  meetingLink,
  reason,
}: {
  calendarColor: string | null | undefined;
  calendarLabel: string | undefined;
  draft: EventDraft;
  mapsUrl: string | null;
  meetingLink: MeetingLink | null;
  reason: string;
}) {
  const location = draft.location.trim();
  const description = draft.description.trim();
  const source = draft.mode === "edit" ? draft.sourceEvent : undefined;
  const repeats = describeEventRecurrence({
    eventType: source?.eventType,
    recurringEventId: source?.recurringEventId,
    rules: draft.recurrence,
    startWeekday: draft.startDate.dayOfWeek,
  });
  // Google keeps birthdays on the primary calendar; name what they are.
  const calendarName =
    source?.eventType === "birthday" ? "Birthdays" : calendarLabel;
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2 rounded-lg bg-muted px-3 py-2.5">
        <Icon as={Lock} className="text-muted-foreground" size={14} />
        <Text className="flex-1 text-muted-foreground text-sm">{reason}</Text>
      </View>
      <View className="gap-1">
        <Text className="font-sans-medium text-foreground text-lg" selectable>
          {draft.summary || "(No title)"}
        </Text>
        <Text className="text-muted-foreground text-sm">
          {describeWhen(draft)}
        </Text>
        {repeats ? (
          <Text className="text-muted-foreground text-sm">{repeats}</Text>
        ) : null}
        {calendarName ? (
          <View className="flex-row items-center gap-1.5">
            <View
              className="size-2 rounded-full bg-muted-foreground"
              style={calendarColor ? { backgroundColor: calendarColor } : null}
            />
            <Text className="text-muted-foreground text-sm">
              {calendarName}
            </Text>
          </View>
        ) : null}
      </View>
      {meetingLink ? (
        <Button
          className="self-start"
          onPress={() => {
            Linking.openURL(meetingLink.url).catch(() => undefined);
          }}
          size="sm"
          variant="outline"
        >
          <Icon as={Video} className="text-foreground" size={14} />
          <Text>Join {meetingLink.label}</Text>
        </Button>
      ) : null}
      {location ? (
        <Pressable
          accessibilityHint={mapsUrl ? "Opens Maps" : undefined}
          accessibilityRole={mapsUrl ? "link" : undefined}
          className="flex-row items-start gap-2"
          disabled={!mapsUrl}
          onPress={() => {
            if (mapsUrl) {
              Linking.openURL(mapsUrl).catch(() => undefined);
            }
          }}
        >
          <Icon
            as={MapPin}
            className="mt-0.5 text-muted-foreground"
            size={14}
          />
          <Text className="flex-1 text-foreground text-sm underline">
            {location}
          </Text>
        </Pressable>
      ) : null}
      {description ? (
        <Text className="text-foreground text-sm leading-5" selectable>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

function EventEditorHeaderRight({
  canSubmit,
  isSaving,
  showDelete,
  onDelete,
  onSubmit,
  submitLabel,
}: {
  canSubmit: boolean;
  /** The save is running: "Saving…" replaces the actions until it ends. */
  isSaving: boolean;
  showDelete: boolean;
  onDelete?: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  if (isSaving) {
    return <Text className="px-2 text-muted-foreground text-sm">Saving…</Text>;
  }
  return (
    <View className="flex-row items-center gap-2">
      {showDelete && onDelete ? (
        <Button
          accessibilityLabel="Delete event"
          accessibilityRole="button"
          onPress={onDelete}
          size="icon"
          variant="ghost"
        >
          <Icon as={Trash2} className="text-red-500" size={18} />
        </Button>
      ) : null}
      <Button
        accessibilityLabel={`${submitLabel} event`}
        accessibilityRole="button"
        disabled={!canSubmit}
        onPress={onSubmit}
        size="icon"
        variant="ghost"
      >
        <Icon
          as={Check}
          className={canSubmit ? "text-green-500" : "text-muted-foreground"}
          size={18}
        />
      </Button>
    </View>
  );
}

function EventAllDayAndMeetingRow({
  allDay,
  mutedColor,
  onToggleAllDay,
  meetingLink,
  isConferencePending,
  onAddMeeting,
}: {
  allDay: boolean;
  mutedColor: string;
  onToggleAllDay: (value: boolean) => void;
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
  onAddMeeting: () => void;
}) {
  const switchActiveColor = "#7DD87D";
  return (
    <View className="mb-2.5 flex-row items-center gap-2">
      <View className="flex-1 flex-row items-center justify-between rounded-full border border-border px-3 py-2.5">
        <Text className="font-medium text-foreground text-sm">All day</Text>
        <RNSwitch
          onValueChange={onToggleAllDay}
          thumbColor={allDay ? "#ffffff" : "#f4f3f4"}
          trackColor={{ false: mutedColor, true: switchActiveColor }}
          value={allDay}
        />
      </View>
      <View className="flex-1 items-end">
        <EventMeetingButton
          isConferencePending={isConferencePending}
          meetingLink={meetingLink}
          onAddMeeting={onAddMeeting}
        />
      </View>
    </View>
  );
}

function EventColorPicker({
  colorEntries,
  selectedColorId,
  selectedColorBackground,
  selectedColorBorder,
  borderColor,
  onSelectColor,
}: {
  colorEntries: [string, { background?: string; foreground?: string }][];
  selectedColorId: string | null;
  selectedColorBackground: string | undefined;
  selectedColorBorder: string;
  borderColor: string;
  onSelectColor: (colorKey: string | null) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityLabel="Pick color"
          style={{
            backgroundColor: selectedColorBackground ?? "transparent",
            borderColor: selectedColorBackground
              ? selectedColorBorder
              : borderColor,
            borderRadius: 999,
            borderWidth: 2,
            height: 32,
            width: 32,
          }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" style={{ padding: 12 }}>
        <View className="flex-row flex-wrap gap-2">
          {colorEntries.map(([colorKey, palette]) => {
            const isSelected = selectedColorId === colorKey;
            return (
              <Pressable
                accessibilityLabel={`Color ${colorKey}`}
                key={colorKey}
                onPress={() => onSelectColor(colorKey)}
                style={{
                  backgroundColor: palette.background ?? "transparent",
                  borderColor: palette.foreground ?? borderColor,
                  borderRadius: 999,
                  borderWidth: 2,
                  height: 28,
                  opacity: isSelected ? 1 : 0.85,
                  width: 28,
                }}
              />
            );
          })}
          <Button
            onPress={() => onSelectColor(null)}
            size="icon"
            variant="ghost"
          >
            <Icon as={X} size={16} />
          </Button>
        </View>
      </PopoverContent>
    </Popover>
  );
}

function EventLocationInput({
  location,
  locationSuggestions,
  mapsUrl,
  onLocationChange,
  onSuggestionClose,
  onSuggestionOpen,
  showLocationSuggestions,
}: {
  location: string;
  locationSuggestions: LocationSuggestion[];
  mapsUrl: string | null;
  onLocationChange: (value: string) => void;
  onSuggestionClose: () => void;
  onSuggestionOpen: () => void;
  showLocationSuggestions: boolean;
}) {
  return (
    <View className="relative z-10 mb-2.5">
      <View className="flex-row items-center gap-2">
        <Input
          containerStyle={{ flex: 1 }}
          onBlur={onSuggestionClose}
          onChangeText={(value) => {
            onLocationChange(value);
            onSuggestionOpen();
          }}
          placeholder="Location"
          value={location}
          variant="outline"
        />
        {mapsUrl ? (
          <Button
            onPress={() => {
              Linking.openURL(mapsUrl).catch((err) => {
                console.warn("Failed to open maps URL:", err);
              });
            }}
            size="icon"
            variant="outline"
          >
            <Icon as={MapPin} className="text-foreground" size={16} />
          </Button>
        ) : null}
      </View>

      {showLocationSuggestions ? (
        <View className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-background shadow-lg">
          {locationSuggestions.map((suggestion: LocationSuggestion, index) => {
            const isLast = index === locationSuggestions.length - 1;
            return (
              <Pressable
                className={`px-3 py-2 ${isLast ? "" : "border-border border-b"}`}
                key={suggestion.placeId ?? suggestion.description}
                onPress={() => {
                  onLocationChange(suggestion.description);
                  onSuggestionClose();
                }}
              >
                <Text className="text-foreground text-sm">
                  {suggestion.primary}
                </Text>
                {suggestion.secondary ? (
                  <Text className="text-muted-foreground text-xs">
                    {suggestion.secondary}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function EventDateTimeRow({
  allDay,
  endDate,
  getValues,
  endDatePickerValue,
  endTimePickerValue,
  setValue,
  startDate,
  startDatePickerValue,
  startTimePickerValue,
}: {
  allDay: boolean;
  endDate: Temporal.PlainDate;
  endDatePickerValue: Date;
  endTimePickerValue: Date;
  getValues: UseFormGetValues<EventDraft>;
  setValue: UseFormSetValue<EventDraft>;
  startDate: Temporal.PlainDate;
  startDatePickerValue: Date;
  startTimePickerValue: Date;
}) {
  // Moving the start keeps the event's length (shared with web).
  const moveStart = (next: {
    date?: Temporal.PlainDate;
    time?: Temporal.PlainTime;
  }) => {
    const moved = moveEventStart(getValues(), next);
    setValue("startDate", moved.startDate, { shouldDirty: true });
    setValue("startTime", moved.startTime, { shouldDirty: true });
    setValue("endDate", moved.endDate, { shouldDirty: true });
    setValue("endTime", moved.endTime, { shouldDirty: true });
  };
  // Two rows, starts then ends, so a 12-hour time ("10:00 AM") never has to
  // shrink to fit beside three other controls.
  return (
    <View className="mb-2.5 gap-1.5">
      <View className="flex-row items-center gap-1.5">
        <View className="min-w-0 flex-1">
          <DatePicker
            accessibilityLabel="Start date"
            displayValue={formatPlainDateCompact(startDate)}
            mode="date"
            onChange={(date) => {
              if (!date) {
                return;
              }
              moveStart({ date: dateToPlainDate(date) });
            }}
            placeholder="Start date"
            showIcon={false}
            style={{ minHeight: 38, paddingHorizontal: 10 }}
            value={startDatePickerValue}
            valueTextStyle={{ fontSize: 13 }}
            variant="outline"
          />
        </View>
        {allDay ? null : (
          <View className="min-w-0 flex-1">
            <DatePicker
              accessibilityLabel="Start time"
              mode="time"
              onChange={(date) => {
                if (!date) {
                  return;
                }
                moveStart({ time: dateToPlainTime(date) });
              }}
              placeholder="Start time"
              showIcon={false}
              style={{ minHeight: 38, paddingHorizontal: 10 }}
              timeFormat={localeTimeFormat()}
              value={startTimePickerValue}
              valueTextStyle={{ fontSize: 13 }}
              variant="outline"
            />
          </View>
        )}
      </View>
      <View className="flex-row items-center gap-1.5">
        <View className="min-w-0 flex-1">
          <DatePicker
            accessibilityLabel="End date"
            displayValue={formatPlainDateCompact(endDate)}
            mode="date"
            onChange={(date) => {
              if (!date) {
                return;
              }
              setValue("endDate", dateToPlainDate(date), {
                shouldDirty: true,
              });
            }}
            placeholder="End date"
            showIcon={false}
            style={{ minHeight: 38, paddingHorizontal: 10 }}
            value={endDatePickerValue}
            valueTextStyle={{ fontSize: 13 }}
            variant="outline"
          />
        </View>
        {allDay ? null : (
          <View className="min-w-0 flex-1">
            <DatePicker
              accessibilityLabel="End time"
              mode="time"
              onChange={(date) => {
                if (!date) {
                  return;
                }
                setValue("endTime", dateToPlainTime(date), {
                  shouldDirty: true,
                });
              }}
              placeholder="End time"
              showIcon={false}
              style={{ minHeight: 38, paddingHorizontal: 10 }}
              timeFormat={localeTimeFormat()}
              value={endTimePickerValue}
              valueTextStyle={{ fontSize: 13 }}
              variant="outline"
            />
          </View>
        )}
      </View>
    </View>
  );
}

const DEFAULT_START_TIME = Temporal.PlainTime.from("09:00");
const DEFAULT_END_TIME = Temporal.PlainTime.from("10:00");

function useEventDatePickerValues({
  startDate,
  endDate,
  startTime,
  endTime,
}: EventDraft) {
  const startDatePickerValue = React.useMemo(
    () => plainDateToPickerDate(startDate),
    [startDate]
  );
  const endDatePickerValue = React.useMemo(
    () => plainDateToPickerDate(endDate),
    [endDate]
  );
  const startTimePickerValue = React.useMemo(
    () => plainTimeToPickerDate(startTime ?? DEFAULT_START_TIME),
    [startTime]
  );
  const endTimePickerValue = React.useMemo(
    () => plainTimeToPickerDate(endTime ?? DEFAULT_END_TIME),
    [endTime]
  );

  return {
    endDate,
    endDatePickerValue,
    endTimePickerValue,
    startDate,
    startDatePickerValue,
    startTimePickerValue,
  };
}

function useEventMeeting(ctx: {
  conferenceData: EventDraft["conferenceData"];
  description: string;
  location: string;
  sourceEvent: GoogleEvent | undefined;
}) {
  const meetingSource = React.useMemo(
    () => ({
      ...(ctx.sourceEvent ?? {}),
      conferenceData: ctx.conferenceData ?? ctx.sourceEvent?.conferenceData,
      description: ctx.description,
      location: ctx.location,
    }),
    [ctx.description, ctx.location, ctx.sourceEvent, ctx.conferenceData]
  );
  const meetingLink = React.useMemo(
    () => extractMeetingLink(meetingSource),
    [meetingSource]
  );
  const isConferencePending = Boolean(
    ctx.conferenceData?.createRequest && !meetingLink
  );
  return { isConferencePending, meetingLink };
}

interface EventEditorSheetProps {
  calendarOptions: CalendarOption[];
  draft: EventDraft;
  /**
   * The save is running: the sheet holds (no second submit, no edits, no
   * dismissal) until it ends.
   */
  isSaving?: boolean;
  /** The occurrence's series pattern is loading. */
  masterLoading?: boolean;
  /**
   * The series' pattern when the event is an occurrence; it can load after
   * the editor opens.
   */
  masterRecurrence?: string[];
  onClose: () => void;
  onDelete?: (draft: EditEventDraft) => void;
  onSubmit: (draft: EventDraft) => void;
  /** Dialogs that open over the editor (iOS presents them from its modal). */
  overlay?: React.ReactNode;
}

/**
 * Create / edit sheet for a Google event. Render it only while a draft is
 * open; it is always visible when mounted.
 */
export function EventEditorSheet({
  draft,
  isSaving = false,
  masterLoading = false,
  masterRecurrence,
  onClose,
  overlay,
  onSubmit,
  onDelete,
  calendarOptions,
}: EventEditorSheetProps) {
  const { getValues, handleSubmit, reset, setValue, watch } =
    useForm<EventDraft>({ defaultValues: draft });
  const values = watch();
  const [isRecurrenceExpanded, setIsRecurrenceExpanded] = React.useState(false);
  const [isLocationSuggestionsOpen, setIsLocationSuggestionsOpen] =
    React.useState(false);

  React.useEffect(() => {
    reset(draft);
    setIsRecurrenceExpanded(false);
    setIsLocationSuggestionsOpen(false);
  }, [draft, reset]);

  // Show the series' pattern once it loads, keeping the other edits, unless
  // the user has already changed the repeat.
  React.useEffect(() => {
    if (
      masterRecurrence?.length &&
      !getValues("recurrenceEdited") &&
      getValues("recurrence").length === 0
    ) {
      setValue("recurrence", masterRecurrence);
    }
  }, [getValues, masterRecurrence, setValue]);

  const { summary, description, location, recurrence, allDay } = values;

  const isCreateMode = draft.mode === "create";
  const readOnlyReason = readOnlyReasonFor(draft, calendarOptions);
  const canSubmit = summary.trim().length > 0 && endsAfterStart(values);
  const submitLabel = isCreateMode ? "Create" : "Save";
  const sheetTitle = isCreateMode ? "New event" : "Edit event";

  // Any editable event can repeat, a one-off one included. While an
  // occurrence's pattern loads, the control waits: a change made before it
  // arrives would be compared against nothing.
  const recurrenceDisabled = masterLoading;

  const primaryRule = getPrimaryRecurrenceRule(recurrence);
  const parsedRecurrence = parseGoogleEventRecurrenceRule(primaryRule);

  const mutedColor = useColor("muted");
  const borderColor = useColor("border");

  const selectedCalendar = values.calendar;
  const selectedCalendarValue = toCalendarOptionValue(selectedCalendar);
  const selectedCalendarOption = React.useMemo(
    () => findCalendarOptionByValue(selectedCalendarValue, calendarOptions),
    [calendarOptions, selectedCalendarValue]
  );

  const paletteForAccount = useAtomValue(
    normalizedGoogleColorsAtomFamily(selectedCalendar.accountId)
  );
  const colorEntries = React.useMemo(
    () =>
      paletteForAccount?.event ? Object.entries(paletteForAccount.event) : [],
    [paletteForAccount]
  );

  const selectedPalette = colorEntries.find(
    ([key]) => key === values.colorId
  )?.[1];
  const selectedColorBackground =
    selectedPalette?.background ??
    pastelizeColor(selectedCalendarOption?.color);
  const selectedColorBorder = selectedPalette?.foreground ?? borderColor;

  const {
    startDate,
    endDate,
    startDatePickerValue,
    endDatePickerValue,
    startTimePickerValue,
    endTimePickerValue,
  } = useEventDatePickerValues(values);

  const locationSearch = useLocationSearch(location);
  const locationSuggestions = locationSearch.data ?? [];
  const showLocationSuggestions =
    isLocationSuggestionsOpen &&
    location.trim().length >= 2 &&
    locationSuggestions.length > 0;

  const mapsUrl =
    location.trim().length > 0 ? getMapsSearchUrl(location) : null;

  const sourceEvent = draft.mode === "edit" ? draft.sourceEvent : undefined;
  const { meetingLink, isConferencePending } = useEventMeeting({
    conferenceData: values.conferenceData,
    description,
    location,
    sourceEvent,
  });

  const applyPrimaryRecurrenceRule = React.useCallback(
    (rule: string | null) => {
      const nextRecurrence = setPrimaryRecurrenceRule(
        getValues("recurrence"),
        rule
      );
      setValue("recurrence", nextRecurrence, { shouldDirty: true });
      setValue("recurrenceEdited", true);
    },
    [getValues, setValue]
  );

  const updateRecurrence = React.useCallback(
    (patch: {
      freq?: EventRecurrenceFrequency;
      byDay?: string[];
      end?: EventRecurrenceEnd;
    }) => {
      const currentRule = getPrimaryRecurrenceRule(getValues("recurrence"));
      const nextRule = buildRecurrenceRuleFromCurrent(currentRule, patch);
      applyPrimaryRecurrenceRule(nextRule);
    },
    [applyPrimaryRecurrenceRule, getValues]
  );

  const recurrenceEditor = (
    <RecurrenceRow
      applyPrimaryRecurrenceRule={applyPrimaryRecurrenceRule}
      disabled={recurrenceDisabled}
      isExpanded={isRecurrenceExpanded}
      onToggle={() => setIsRecurrenceExpanded((current) => !current)}
      parsedRecurrence={parsedRecurrence}
      recurrence={recurrence}
      startDate={values.startDate}
      updateRecurrence={updateRecurrence}
    />
  );

  const calendarPickerOptions = React.useMemo(
    () =>
      // Only calendars the user can write to are destinations.
      calendarOptions
        .filter((option) => canWriteCalendar(option.accessRole))
        .map((option) => ({
          color: option.color ?? null,
          label: option.label,
          value: toCalendarOptionValue(option),
        })),
    [calendarOptions]
  );

  const handleCalendarChange = React.useCallback(
    (value: string) => {
      const nextOption = findCalendarOptionByValue(value, calendarOptions);
      if (!nextOption) {
        return;
      }
      setValue(
        "calendar",
        { accountId: nextOption.accountId, calendarId: nextOption.calendarId },
        { shouldDirty: true }
      );
    },
    [calendarOptions, setValue]
  );

  const handleSheetSubmit = handleSubmit(onSubmit);

  const handleDelete = React.useCallback(() => {
    const currentDraft = getValues();
    if (currentDraft.mode === "edit" && onDelete) {
      onDelete(currentDraft);
    }
  }, [getValues, onDelete]);

  if (readOnlyReason) {
    return (
      <BottomSheet
        headerRight={
          <Button
            accessibilityLabel="Close"
            onPress={onClose}
            size="icon"
            variant="ghost"
          >
            <Icon as={X} className="text-foreground" size={18} />
          </Button>
        }
        isVisible
        onClose={onClose}
        snapPoints={[0.42, 0.95]}
        title="Event"
      >
        <ReadOnlyEventView
          calendarColor={selectedCalendarOption?.color}
          calendarLabel={selectedCalendarOption?.label}
          draft={draft}
          mapsUrl={mapsUrl}
          meetingLink={meetingLink}
          reason={readOnlyReason}
        />
      </BottomSheet>
    );
  }

  const headerRight = (
    <EventEditorHeaderRight
      canSubmit={canSubmit}
      isSaving={isSaving}
      onDelete={draft.mode === "edit" ? handleDelete : undefined}
      onSubmit={handleSheetSubmit}
      showDelete={draft.mode === "edit" && Boolean(onDelete)}
      submitLabel={submitLabel}
    />
  );

  return (
    <BottomSheet
      disablePanGesture={isSaving}
      enableBackdropDismiss={!isSaving}
      headerRight={headerRight}
      isVisible
      onClose={isSaving ? noop : onClose}
      snapPoints={[0.84, 0.95, 0.99]}
      title={sheetTitle}
    >
      <HeldWhileSaving isSaving={isSaving}>
        {/* The title first: it's the most-edited field, and on create the
            first thing typed. */}
        <View className="mb-2.5 flex-row items-center gap-2">
          <EventColorPicker
            borderColor={borderColor}
            colorEntries={colorEntries}
            onSelectColor={(colorKey) =>
              setValue("colorId", colorKey, { shouldDirty: true })
            }
            selectedColorBackground={selectedColorBackground}
            selectedColorBorder={selectedColorBorder}
            selectedColorId={values.colorId ?? null}
          />

          <Input
            containerStyle={{ flex: 1 }}
            onChangeText={(value) =>
              setValue("summary", value, { shouldDirty: true })
            }
            placeholder="Title"
            value={summary}
            variant="outline"
          />
        </View>

        <EventDateTimeRow
          allDay={allDay}
          endDate={endDate}
          endDatePickerValue={endDatePickerValue}
          endTimePickerValue={endTimePickerValue}
          getValues={getValues}
          setValue={setValue}
          startDate={startDate}
          startDatePickerValue={startDatePickerValue}
          startTimePickerValue={startTimePickerValue}
        />
        {/* Save stays off until the end comes after the start; say why. */}
        {endsAfterStart(values) ? null : (
          <Text className="-mt-1 mb-2.5 text-destructive text-xs">
            Ends before it starts.
          </Text>
        )}

        {recurrenceEditor}

        <EventAllDayAndMeetingRow
          allDay={allDay}
          isConferencePending={isConferencePending}
          meetingLink={meetingLink}
          mutedColor={mutedColor}
          onAddMeeting={() =>
            setValue("conferenceData", buildGoogleMeetConferenceData(), {
              shouldDirty: true,
            })
          }
          onToggleAllDay={(nextValue) =>
            setValue("allDay", nextValue, { shouldDirty: true })
          }
        />

        <EventLocationInput
          location={location}
          locationSuggestions={locationSuggestions}
          mapsUrl={mapsUrl}
          onLocationChange={(value) => {
            setValue("location", value, { shouldDirty: true });
          }}
          onSuggestionClose={() => setIsLocationSuggestionsOpen(false)}
          onSuggestionOpen={() => setIsLocationSuggestionsOpen(true)}
          showLocationSuggestions={showLocationSuggestions}
        />

        <Textarea
          containerStyle={{ marginBottom: 10 }}
          onChangeText={(value) =>
            setValue("description", value, { shouldDirty: true })
          }
          placeholder="Description"
          value={description}
          variant="outline"
        />

        <Picker
          modalTitle="Select calendar"
          onValueChange={handleCalendarChange}
          options={calendarPickerOptions}
          placeholder="Select calendar"
          style={{ marginBottom: 10 }}
          value={selectedCalendarValue}
          variant="outline"
        />
      </HeldWhileSaving>
      {overlay}
    </BottomSheet>
  );
}
