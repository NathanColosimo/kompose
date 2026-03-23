import type { LocationSuggestion } from "@kompose/api/routers/maps/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@kompose/state/atoms/google-colors";
import {
  buildGoogleEventRecurrenceRule,
  dateToUntilRule,
  type EventRecurrenceEnd,
  type EventRecurrenceFrequency,
  GOOGLE_EVENT_WEEKDAYS,
  getPrimaryRecurrenceRule,
  isRecurringGoogleEvent,
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
import { useAtomValue } from "jotai";
import { Check, MapPin, Repeat2, Trash2, Video, X } from "lucide-react-native";
import React from "react";
import { useForm } from "react-hook-form";
import { Linking, Pressable, Switch as RNSwitch, View } from "react-native";
import { Temporal } from "temporal-polyfill";
import type {
  CalendarOption,
  CreateEventDraft,
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

const RECURRENCE_FREQUENCIES: Array<{
  value: EventRecurrenceFrequency;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

interface EventEditorFormValues {
  allDay: boolean;
  calendar: {
    accountId: string;
    calendarId: string;
  };
  colorId: string | null;
  conferenceData: EventDraft["conferenceData"];
  description: string;
  endDate: Temporal.PlainDate;
  endTime: Temporal.PlainTime | null;
  location: string;
  recurrence: string[];
  startDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime | null;
  summary: string;
}

function toFormValues(draft: EventDraft): EventEditorFormValues {
  return {
    summary: draft.summary,
    description: draft.description,
    location: draft.location,
    colorId: draft.colorId ?? null,
    calendar: draft.calendar,
    allDay: draft.allDay,
    startDate: draft.startDate,
    endDate: draft.endDate,
    startTime: draft.startTime,
    endTime: draft.endTime,
    recurrence: draft.recurrence,
    conferenceData: draft.conferenceData ?? null,
  };
}

function applyFormValuesToDraft(
  draft: EventDraft,
  values: EventEditorFormValues
): EventDraft {
  return {
    ...draft,
    summary: values.summary,
    description: values.description,
    location: values.location,
    colorId: values.colorId,
    calendar: values.calendar,
    allDay: values.allDay,
    startDate: values.startDate,
    endDate: values.endDate,
    startTime: values.startTime,
    endTime: values.endTime,
    recurrence: values.recurrence,
    conferenceData: values.conferenceData,
  };
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
    month: "short",
    day: "numeric",
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

function RecurrenceEditorSection({
  parsedRecurrence,
  updateRecurrence,
  applyPrimaryRecurrenceRule,
}: {
  parsedRecurrence: ReturnType<typeof parseGoogleEventRecurrenceRule>;
  updateRecurrence: (patch: {
    freq?: EventRecurrenceFrequency;
    byDay?: string[];
    end?: EventRecurrenceEnd;
  }) => void;
  applyPrimaryRecurrenceRule: (rule: string | null) => void;
}) {
  return (
    <View className="mb-2.5 rounded-md border border-border px-3 py-2.5">
      <View className="flex-row flex-wrap gap-2">
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

                let byDay: string[] = [];
                if (frequency.value === "WEEKLY") {
                  byDay =
                    parsedRecurrence.byDay.length > 0
                      ? parsedRecurrence.byDay
                      : ["MO"];
                }
                updateRecurrence({ freq: frequency.value, byDay });
              }}
              size="sm"
              variant={active ? "default" : "outline"}
            >
              <Text>{frequency.label}</Text>
            </Button>
          );
        })}
      </View>

      {parsedRecurrence.freq === "WEEKLY" ? (
        <View className="mt-3">
          <Text className="text-muted-foreground text-xs">On days</Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {GOOGLE_EVENT_WEEKDAYS.map((weekday) => {
              const selected = parsedRecurrence.byDay.includes(weekday.value);
              return (
                <Button
                  key={weekday.value}
                  onPress={() => {
                    const nextByDay = selected
                      ? parsedRecurrence.byDay.filter(
                          (value) => value !== weekday.value
                        )
                      : [...parsedRecurrence.byDay, weekday.value];
                    updateRecurrence({ byDay: nextByDay });
                  }}
                  size="sm"
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
      <View className="mt-1 flex-row flex-wrap gap-2">
        <Button
          onPress={() => updateRecurrence({ end: { type: "none" } })}
          size="sm"
          variant={parsedRecurrence.end.type === "none" ? "default" : "outline"}
        >
          <Text>Never</Text>
        </Button>
        <Button
          onPress={() => {
            const fallbackUntil =
              parsedRecurrence.end.type === "until"
                ? parsedRecurrence.end.date
                : (dateToUntilRule(new Date()) ?? undefined);
            updateRecurrence({
              end: fallbackUntil
                ? { type: "until", date: fallbackUntil }
                : { type: "none" },
            });
          }}
          size="sm"
          variant={
            parsedRecurrence.end.type === "until" ? "default" : "outline"
          }
        >
          <Text>On date</Text>
        </Button>
        <Button
          onPress={() =>
            updateRecurrence({
              end: {
                type: "count",
                count:
                  parsedRecurrence.end.type === "count"
                    ? parsedRecurrence.end.count
                    : 5,
              },
            })
          }
          size="sm"
          variant={
            parsedRecurrence.end.type === "count" ? "default" : "outline"
          }
        >
          <Text>After N</Text>
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
                  ? { type: "until", date: untilRule }
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
                  type: "count",
                  count:
                    Number.isFinite(nextCount) && nextCount > 0 ? nextCount : 1,
                },
              });
            }}
            value={String(parsedRecurrence.end.count)}
            variant="outline"
          />
          <Text className="text-foreground text-xs">occurrences</Text>
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

function EventEditorHeaderRight({
  canSubmit,
  showDelete,
  onDelete,
  onSubmit,
  submitLabel,
}: {
  canSubmit: boolean;
  showDelete: boolean;
  onDelete?: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      {showDelete && onDelete ? (
        <Button onPress={onDelete} size="icon" variant="ghost">
          <Icon as={Trash2} className="text-red-500" size={18} />
        </Button>
      ) : null}
      <Button
        accessibilityLabel={submitLabel}
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
            width: 32,
            height: 32,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: selectedColorBackground
              ? selectedColorBorder
              : borderColor,
            backgroundColor: selectedColorBackground ?? "transparent",
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
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: palette.foreground ?? borderColor,
                  backgroundColor: palette.background ?? "transparent",
                  opacity: isSelected ? 1 : 0.85,
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
  canEditRecurrence,
  endDate,
  endDatePickerValue,
  endTimePickerValue,
  isRecurrenceExpanded,
  onToggleRecurrence,
  setValue,
  startDate,
  startDatePickerValue,
  startTimePickerValue,
  timeZone,
}: {
  allDay: boolean;
  canEditRecurrence: boolean;
  endDate: Temporal.PlainDate;
  endDatePickerValue: Date;
  endTimePickerValue: Date;
  isRecurrenceExpanded: boolean;
  onToggleRecurrence: () => void;
  setValue: ReturnType<typeof useForm<EventEditorFormValues>>["setValue"];
  startDate: Temporal.PlainDate;
  startDatePickerValue: Date;
  startTimePickerValue: Date;
  timeZone: string;
}) {
  return (
    <View className="mb-2.5 flex-row items-center gap-1.5">
      <View className="min-w-0 flex-1">
        <DatePicker
          displayValue={formatPlainDateCompact(startDate)}
          mode="date"
          onChange={(date) => {
            if (!date) {
              return;
            }
            const nextDate = dateToPlainDate(date, timeZone);
            const nextEndDate =
              Temporal.PlainDate.compare(nextDate, endDate) > 0
                ? nextDate
                : endDate;
            setValue("startDate", nextDate, { shouldDirty: true });
            setValue("endDate", nextEndDate, { shouldDirty: true });
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
            mode="time"
            onChange={(date) => {
              if (!date) {
                return;
              }
              const nextTime = dateToPlainTime(date, timeZone);
              setValue("startTime", nextTime, { shouldDirty: true });
              setValue("endTime", nextTime.add({ minutes: 30 }), {
                shouldDirty: true,
              });
            }}
            placeholder="Start time"
            showIcon={false}
            style={{ minHeight: 38, paddingHorizontal: 10 }}
            timeFormat="24"
            value={startTimePickerValue}
            valueTextStyle={{ fontSize: 13 }}
            variant="outline"
          />
        </View>
      )}
      <View className="min-w-0 flex-1">
        <DatePicker
          displayValue={formatPlainDateCompact(endDate)}
          mode="date"
          onChange={(date) => {
            if (!date) {
              return;
            }
            setValue("endDate", dateToPlainDate(date, timeZone), {
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
            mode="time"
            onChange={(date) => {
              if (!date) {
                return;
              }
              setValue("endTime", dateToPlainTime(date, timeZone), {
                shouldDirty: true,
              });
            }}
            placeholder="End time"
            showIcon={false}
            style={{ minHeight: 38, paddingHorizontal: 10 }}
            timeFormat="24"
            value={endTimePickerValue}
            valueTextStyle={{ fontSize: 13 }}
            variant="outline"
          />
        </View>
      )}
      {canEditRecurrence ? (
        <Button
          onPress={onToggleRecurrence}
          size="icon"
          style={{ height: 38, width: 38 }}
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
      ) : null}
    </View>
  );
}

const DEFAULT_START_TIME = Temporal.PlainTime.from("09:00");
const DEFAULT_END_TIME = Temporal.PlainTime.from("10:00");

function useEventDatePickerValues(
  values: EventEditorFormValues,
  draft: EventDraft
) {
  const startDate = values.startDate ?? draft.startDate;
  const endDate = values.endDate ?? draft.endDate;
  const startTime = values.startTime ?? draft.startTime;
  const endTime = values.endTime ?? draft.endTime;

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
    startDate,
    endDate,
    startDatePickerValue,
    endDatePickerValue,
    startTimePickerValue,
    endTimePickerValue,
  };
}

function resolveFormDefaults(values: EventEditorFormValues) {
  return {
    summary: values.summary ?? "",
    description: values.description ?? "",
    location: values.location ?? "",
    recurrence: values.recurrence ?? [],
    allDay: Boolean(values.allDay),
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
      location: ctx.location,
      description: ctx.description,
      conferenceData: ctx.conferenceData ?? ctx.sourceEvent?.conferenceData,
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
  return { meetingLink, isConferencePending };
}

interface EventEditorSheetProps {
  calendarOptions: CalendarOption[];
  draft: EventDraft;
  isVisible: boolean;
  onClose: () => void;
  onDelete?: (draft: EditEventDraft) => void;
  onSubmit: (draft: EventDraft) => void;
  timeZone: string;
}

function EventEditorSheet({
  draft,
  isVisible,
  onClose,
  onSubmit,
  onDelete,
  timeZone,
  calendarOptions,
}: EventEditorSheetProps) {
  const { getValues, handleSubmit, reset, setValue, watch } =
    useForm<EventEditorFormValues>({
      defaultValues: toFormValues(draft),
    });
  const values = watch();
  const [isRecurrenceExpanded, setIsRecurrenceExpanded] = React.useState(false);
  const [isLocationSuggestionsOpen, setIsLocationSuggestionsOpen] =
    React.useState(false);

  React.useEffect(() => {
    reset(toFormValues(draft));
    setIsRecurrenceExpanded(false);
    setIsLocationSuggestionsOpen(false);
  }, [draft, reset]);

  const { summary, description, location, recurrence, allDay } =
    resolveFormDefaults(values);

  const canSubmit = summary.trim().length > 0;
  const isCreateMode = draft.mode === "create";
  const submitLabel = isCreateMode ? "Create" : "Save";
  const sheetTitle = isCreateMode ? "New event" : "Edit event";

  const canEditRecurrence =
    isCreateMode ||
    isRecurringGoogleEvent({
      event: isCreateMode ? null : draft.sourceEvent,
      masterRecurrence: recurrence,
    });

  const primaryRule = getPrimaryRecurrenceRule(recurrence);
  const parsedRecurrence = parseGoogleEventRecurrenceRule(primaryRule);

  const mutedColor = useColor("muted");
  const borderColor = useColor("border");

  const selectedCalendar = values.calendar ?? draft.calendar;
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
  } = useEventDatePickerValues(values, draft);

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

  const recurrenceEditor =
    canEditRecurrence && isRecurrenceExpanded ? (
      <RecurrenceEditorSection
        applyPrimaryRecurrenceRule={applyPrimaryRecurrenceRule}
        parsedRecurrence={parsedRecurrence}
        updateRecurrence={updateRecurrence}
      />
    ) : null;

  const calendarPickerOptions = React.useMemo(
    () =>
      calendarOptions.map((option) => ({
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

  const handleSheetSubmit = handleSubmit((nextValues) => {
    onSubmit(applyFormValuesToDraft(draft, nextValues));
  });

  const handleDelete = React.useCallback(() => {
    if (!(draft.mode === "edit" && onDelete)) {
      return;
    }
    const nextDraft = applyFormValuesToDraft(
      draft,
      getValues()
    ) as EditEventDraft;
    onDelete(nextDraft);
  }, [draft, getValues, onDelete]);

  const headerRight = (
    <EventEditorHeaderRight
      canSubmit={canSubmit}
      onDelete={draft.mode === "edit" ? handleDelete : undefined}
      onSubmit={handleSheetSubmit}
      showDelete={draft.mode === "edit" && Boolean(onDelete)}
      submitLabel={submitLabel}
    />
  );

  return (
    <BottomSheet
      headerRight={headerRight}
      isVisible={isVisible}
      onClose={onClose}
      snapPoints={[0.84, 0.95, 0.99]}
      title={sheetTitle}
    >
      <EventDateTimeRow
        allDay={allDay}
        canEditRecurrence={canEditRecurrence}
        endDate={endDate}
        endDatePickerValue={endDatePickerValue}
        endTimePickerValue={endTimePickerValue}
        isRecurrenceExpanded={isRecurrenceExpanded}
        onToggleRecurrence={() =>
          setIsRecurrenceExpanded((current) => !current)
        }
        setValue={setValue}
        startDate={startDate}
        startDatePickerValue={startDatePickerValue}
        startTimePickerValue={startTimePickerValue}
        timeZone={timeZone}
      />

      {recurrenceEditor}

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
    </BottomSheet>
  );
}

interface CreateEventEditorSheetProps {
  calendarOptions: CalendarOption[];
  draft: CreateEventDraft;
  isVisible: boolean;
  onClose: () => void;
  onCreate: (draft: CreateEventDraft) => void;
  timeZone: string;
}

export function CreateEventEditorSheet(props: CreateEventEditorSheetProps) {
  return (
    <EventEditorSheet
      calendarOptions={props.calendarOptions}
      draft={props.draft}
      isVisible={props.isVisible}
      onClose={props.onClose}
      onSubmit={(draft) => props.onCreate(draft as CreateEventDraft)}
      timeZone={props.timeZone}
    />
  );
}

interface EditEventEditorSheetProps {
  calendarOptions: CalendarOption[];
  draft: EditEventDraft;
  isVisible: boolean;
  onClose: () => void;
  onDelete: (draft: EditEventDraft) => void;
  onSave: (draft: EditEventDraft) => void;
  timeZone: string;
}

export function EditEventEditorSheet(props: EditEventEditorSheetProps) {
  return (
    <EventEditorSheet
      calendarOptions={props.calendarOptions}
      draft={props.draft}
      isVisible={props.isVisible}
      onClose={props.onClose}
      onDelete={props.onDelete}
      onSubmit={(draft) => props.onSave(draft as EditEventDraft)}
      timeZone={props.timeZone}
    />
  );
}
