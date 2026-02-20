import type { LocationSuggestion } from "@kompose/api/routers/maps/contract";
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
import { useColor } from "@/hooks/useColor";

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

  const summary = values.summary ?? "";
  const description = values.description ?? "";
  const location = values.location ?? "";
  const recurrence = values.recurrence ?? [];
  const allDay = Boolean(values.allDay);

  const canSubmit = summary.trim().length > 0;
  const submitLabel = draft.mode === "create" ? "Create" : "Save";
  const sheetTitle = draft.mode === "create" ? "New event" : "Edit event";

  const canEditRecurrence =
    draft.mode === "create" ||
    isRecurringGoogleEvent({
      event: draft.mode === "edit" ? draft.sourceEvent : null,
      masterRecurrence: recurrence,
    });

  const primaryRule = getPrimaryRecurrenceRule(recurrence);
  const parsedRecurrence = parseGoogleEventRecurrenceRule(primaryRule);

  const mutedColor = useColor("muted");
  const borderColor = useColor("border");
  const switchActiveColor = "#7DD87D";

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

  const selectedColorBackground =
    colorEntries.find(([key]) => key === values.colorId)?.[1]?.background ??
    pastelizeColor(selectedCalendarOption?.color) ??
    undefined;
  const selectedColorBorder =
    colorEntries.find(([key]) => key === values.colorId)?.[1]?.foreground ??
    borderColor;

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
  const startTimePickerValue = React.useMemo(() => {
    const fallbackTime = Temporal.PlainTime.from("09:00");
    return plainTimeToPickerDate(startTime ?? fallbackTime);
  }, [startTime]);
  const endTimePickerValue = React.useMemo(() => {
    const fallbackTime = Temporal.PlainTime.from("10:00");
    return plainTimeToPickerDate(endTime ?? fallbackTime);
  }, [endTime]);

  const locationSearch = useLocationSearch(location);
  const locationSuggestions = locationSearch.data ?? [];
  const showLocationSuggestions =
    isLocationSuggestionsOpen &&
    location.trim().length >= 2 &&
    locationSuggestions.length > 0;

  const mapsUrl =
    location.trim().length > 0 ? getMapsSearchUrl(location) : null;

  const sourceEvent = draft.mode === "edit" ? draft.sourceEvent : undefined;
  const meetingSource = React.useMemo(
    () => ({
      ...(sourceEvent ?? {}),
      location,
      description,
      conferenceData: values.conferenceData ?? sourceEvent?.conferenceData,
    }),
    [description, location, sourceEvent, values.conferenceData]
  );
  const meetingLink = React.useMemo(
    () => extractMeetingLink(meetingSource),
    [meetingSource]
  );
  const isConferencePending = Boolean(
    values.conferenceData?.createRequest && !meetingLink
  );

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

                  updateRecurrence({
                    freq: frequency.value,
                    byDay:
                      frequency.value === "WEEKLY"
                        ? parsedRecurrence.byDay.length > 0
                          ? parsedRecurrence.byDay
                          : ["MO"]
                        : [],
                  });
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

        {parsedRecurrence.freq !== "none" ? (
          <View className="mt-3">
            <Text className="text-muted-foreground text-xs">Ends</Text>
            <View className="mt-1 flex-row flex-wrap gap-2">
              <Button
                onPress={() => updateRecurrence({ end: { type: "none" } })}
                size="sm"
                variant={
                  parsedRecurrence.end.type === "none" ? "default" : "outline"
                }
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
                  value={
                    untilRuleToDate(parsedRecurrence.end.date) ?? undefined
                  }
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
                          Number.isFinite(nextCount) && nextCount > 0
                            ? nextCount
                            : 1,
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
        ) : null}
      </View>
    ) : null;

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

  return (
    <BottomSheet
      headerRight={
        <View className="flex-row items-center gap-2">
          {draft.mode === "edit" && onDelete ? (
            <Button onPress={handleDelete} size="icon" variant="ghost">
              <Icon as={Trash2} className="text-red-500" size={18} />
            </Button>
          ) : null}
          <Button
            accessibilityLabel={submitLabel}
            disabled={!canSubmit}
            onPress={handleSheetSubmit}
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
      }
      isVisible={isVisible}
      onClose={onClose}
      snapPoints={[0.84, 0.95, 0.99]}
      title={sheetTitle}
    >
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
            onPress={() => setIsRecurrenceExpanded((current) => !current)}
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

      {recurrenceEditor}

      <View className="mb-2.5 flex-row items-center gap-2">
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
                const isSelected = values.colorId === colorKey;
                return (
                  <Pressable
                    accessibilityLabel={`Color ${colorKey}`}
                    key={colorKey}
                    onPress={() =>
                      setValue("colorId", colorKey, { shouldDirty: true })
                    }
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
                onPress={() => setValue("colorId", null, { shouldDirty: true })}
                size="icon"
                variant="ghost"
              >
                <Icon as={X} size={16} />
              </Button>
            </View>
          </PopoverContent>
        </Popover>

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

      <View className="mb-2.5 flex-row items-center gap-2">
        <View className="flex-1 flex-row items-center justify-between rounded-full border border-border px-3 py-2.5">
          <Text className="font-medium text-foreground text-sm">All day</Text>
          <RNSwitch
            onValueChange={(nextValue) =>
              setValue("allDay", nextValue, { shouldDirty: true })
            }
            thumbColor={allDay ? "#ffffff" : "#f4f3f4"}
            trackColor={{ false: mutedColor, true: switchActiveColor }}
            value={allDay}
          />
        </View>

        <View className="flex-1 items-end">
          {meetingLink ? (
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
          ) : isConferencePending ? (
            <Text className="text-right text-muted-foreground text-xs">
              Meet on save
            </Text>
          ) : (
            <Button
              onPress={() =>
                setValue("conferenceData", buildGoogleMeetConferenceData(), {
                  shouldDirty: true,
                })
              }
              size="sm"
              variant="outline"
            >
              <Icon as={Video} className="text-foreground" size={14} />
              <Text>Add Meet</Text>
            </Button>
          )}
        </View>
      </View>

      <View className="relative z-10 mb-2.5">
        <View className="flex-row items-center gap-2">
          <Input
            containerStyle={{ flex: 1 }}
            onBlur={() => setIsLocationSuggestionsOpen(false)}
            onChangeText={(value) => {
              setValue("location", value, { shouldDirty: true });
              setIsLocationSuggestionsOpen(true);
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
            {locationSuggestions.map(
              (suggestion: LocationSuggestion, index) => {
                const isLast = index === locationSuggestions.length - 1;
                return (
                  <Pressable
                    className={`px-3 py-2 ${isLast ? "" : "border-border border-b"}`}
                    key={suggestion.placeId ?? suggestion.description}
                    onPress={() => {
                      setValue("location", suggestion.description, {
                        shouldDirty: true,
                      });
                      setIsLocationSuggestionsOpen(false);
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
              }
            )}
          </View>
        ) : null}
      </View>

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
        onValueChange={(value) => {
          const nextOption = findCalendarOptionByValue(value, calendarOptions);
          if (!nextOption) {
            return;
          }
          setValue(
            "calendar",
            {
              accountId: nextOption.accountId,
              calendarId: nextOption.calendarId,
            },
            { shouldDirty: true }
          );
        }}
        options={calendarOptions.map((option) => ({
          color: option.color ?? null,
          label: option.label,
          value: toCalendarOptionValue(option),
        }))}
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
