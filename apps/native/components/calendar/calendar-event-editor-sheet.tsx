import type { LocationSuggestion } from "@kompose/api/routers/maps/contract";
import type { MeetingLink } from "@kompose/state/meeting";
import { MapPin, Video } from "lucide-react-native";
import React from "react";
import { Linking, Pressable, View } from "react-native";
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
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";

type EventDraftUpdater<TDraft extends EventDraft> = (
  updater: (previous: TDraft) => TDraft
) => void;

// Date pickers operate in device-local dates/times. Use local components to avoid
// timezone-shifted values in the form controls.
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

function formatPlainDateShort(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(plainDateToPickerDate(date));
}

function formatPlainTime24(time: Temporal.PlainTime | null): string {
  if (!time) {
    return "--:--";
  }
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function getCalendarLabel(
  draft: EventDraft,
  calendarOptions: CalendarOption[]
): string {
  const selectedOption = calendarOptions.find(
    (option) =>
      option.accountId === draft.calendar.accountId &&
      option.calendarId === draft.calendar.calendarId
  );

  return selectedOption?.label ?? "Select calendars first";
}

interface EventEditorSheetBaseProps<TDraft extends EventDraft> {
  draft: TDraft;
  isVisible: boolean;
  setDraft: EventDraftUpdater<TDraft>;
  onClose: () => void;
  onSubmit: () => void;
  onDelete?: () => void;
  submitLabel: string;
  title: string;
  canChangeCalendar: boolean;
  timeZone: string;
  calendarOptions: CalendarOption[];
  locationSuggestions: LocationSuggestion[];
  showLocationSuggestions: boolean;
  onLocationSuggestionsOpenChange: (isOpen: boolean) => void;
  mapsUrl: string | null;
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
  onAddGoogleMeet: () => void;
}

function EventEditorSheetBase<TDraft extends EventDraft>({
  draft,
  isVisible,
  setDraft,
  onClose,
  onSubmit,
  onDelete,
  submitLabel,
  title,
  canChangeCalendar,
  timeZone,
  calendarOptions,
  locationSuggestions,
  showLocationSuggestions,
  onLocationSuggestionsOpenChange,
  mapsUrl,
  meetingLink,
  isConferencePending,
  onAddGoogleMeet,
}: EventEditorSheetBaseProps<TDraft>) {
  const calendarLabel = getCalendarLabel(draft, calendarOptions);
  const canSubmit = draft.summary.trim().length > 0;

  const startDatePickerValue = React.useMemo(() => {
    return plainDateToPickerDate(draft.startDate);
  }, [draft.startDate]);

  const startTimePickerValue = React.useMemo(() => {
    const fallbackTime = Temporal.PlainTime.from("09:00");
    return plainTimeToPickerDate(draft.startTime ?? fallbackTime);
  }, [draft.startTime]);

  const endDatePickerValue = React.useMemo(() => {
    return plainDateToPickerDate(draft.endDate);
  }, [draft.endDate]);

  const endTimePickerValue = React.useMemo(() => {
    const fallbackTime = Temporal.PlainTime.from("10:00");
    return plainTimeToPickerDate(draft.endTime ?? fallbackTime);
  }, [draft.endTime]);

  return (
    <BottomSheet
      headerRight={
        <Button disabled={!canSubmit} onPress={onSubmit}>
          <Text>{submitLabel}</Text>
        </Button>
      }
      isVisible={isVisible}
      onClose={onClose}
      snapPoints={[0.84, 0.95, 0.99]}
      title={title}
    >
      <Input
        containerStyle={{ marginBottom: 12 }}
        onChangeText={(value) =>
          setDraft((current) => ({ ...current, summary: value }))
        }
        placeholder="Title"
        variant="outline"
        value={draft.summary}
      />

      <Textarea
        containerStyle={{ marginBottom: 12 }}
        onChangeText={(value) =>
          setDraft((current) => ({ ...current, description: value }))
        }
        placeholder="Description"
        value={draft.description}
        variant="outline"
      />

      <View className="relative z-10 mb-3">
        <View className="flex-row items-center gap-2">
          <Input
            containerStyle={{ flex: 1 }}
            onBlur={() => onLocationSuggestionsOpenChange(false)}
            onChangeText={(value) => {
              setDraft((current) => ({ ...current, location: value }));
              onLocationSuggestionsOpenChange(true);
            }}
            placeholder="Location"
            variant="outline"
            value={draft.location}
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
            {locationSuggestions.map((suggestion, index) => {
              const isLast = index === locationSuggestions.length - 1;
              return (
                <Pressable
                  className={`px-3 py-2 ${isLast ? "" : "border-border border-b"}`}
                  key={suggestion.placeId ?? suggestion.description}
                  onPress={() => {
                    setDraft((current) => ({
                      ...current,
                      location: suggestion.description,
                    }));
                    onLocationSuggestionsOpenChange(false);
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

      <View className="mb-3">
        <Text className="mb-2 font-semibold text-foreground text-sm">
          Meeting
        </Text>
        {meetingLink ? (
          <Button
            onPress={() => {
              Linking.openURL(meetingLink.url).catch((err) => {
                console.warn("Failed to open meeting URL:", err);
              });
            }}
            variant="outline"
          >
            <Icon as={Video} className="text-foreground" size={16} />
            <Text>Join {meetingLink.label}</Text>
          </Button>
        ) : isConferencePending ? (
          <Text className="text-muted-foreground text-xs">
            Google Meet will be created when you save.
          </Text>
        ) : (
          <Button onPress={onAddGoogleMeet} variant="outline">
            <Icon as={Video} className="text-foreground" size={16} />
            <Text>Add Google Meet</Text>
          </Button>
        )}
      </View>

      {canChangeCalendar ? (
        <Button
          disabled={calendarOptions.length === 0}
          onPress={() => {
            setDraft((current) => {
              const currentIndex = calendarOptions.findIndex(
                (option) =>
                  option.accountId === current.calendar.accountId &&
                  option.calendarId === current.calendar.calendarId
              );
              const nextOption =
                calendarOptions[(currentIndex + 1) % calendarOptions.length];

              if (!nextOption) {
                return current;
              }

              return {
                ...current,
                calendar: {
                  accountId: nextOption.accountId,
                  calendarId: nextOption.calendarId,
                },
              };
            });
          }}
          style={{ marginBottom: 10 }}
          variant="outline"
        >
          <Text>Calendar: {calendarLabel}</Text>
        </Button>
      ) : (
        <View className="mb-2.5 rounded-md border border-border px-3 py-2">
          <Text className="text-muted-foreground text-xs">Calendar</Text>
          <Text className="mt-1 text-foreground text-sm">{calendarLabel}</Text>
        </View>
      )}

      <Switch
        label="All day"
        onValueChange={(nextValue) =>
          setDraft((current) => ({ ...current, allDay: nextValue }))
        }
        value={Boolean(draft.allDay)}
      />

      <View className="mb-2 rounded-md border border-border px-3 py-2.5">
        <Text className="text-muted-foreground text-xs">Schedule</Text>
        {draft.allDay ? (
          <Text className="mt-1 text-foreground text-sm">
            {formatPlainDateShort(draft.startDate)} to{" "}
            {formatPlainDateShort(draft.endDate)}
          </Text>
        ) : (
          <Text className="mt-1 text-foreground text-sm">
            {formatPlainDateShort(draft.startDate)} {formatPlainTime24(draft.startTime)} -{" "}
            {formatPlainDateShort(draft.endDate)} {formatPlainTime24(draft.endTime)}
          </Text>
        )}
      </View>

      <View className="mb-2.5 flex-row gap-2">
        <View style={{ flex: 1 }}>
          <DatePicker
            mode="date"
            onChange={(date) => {
              if (!date) {
                return;
              }

              setDraft((current) => {
                const nextDate = dateToPlainDate(date, timeZone);
                const nextEndDate =
                  Temporal.PlainDate.compare(nextDate, current.endDate) > 0
                    ? nextDate
                    : current.endDate;

                return {
                  ...current,
                  startDate: nextDate,
                  endDate: nextEndDate,
                };
              });
            }}
            placeholder="Start date"
            value={startDatePickerValue}
            variant="outline"
          />
        </View>
        {draft.allDay ? null : (
          <View style={{ flex: 1 }}>
            <DatePicker
              mode="time"
              onChange={(date) => {
                if (!date) {
                  return;
                }

                setDraft((current) => {
                  const nextTime = dateToPlainTime(date, timeZone);
                  return {
                    ...current,
                    startTime: nextTime,
                    endTime: nextTime.add({ minutes: 30 }),
                  };
                });
              }}
              placeholder="Start time"
              timeFormat="24"
              value={startTimePickerValue}
              variant="outline"
            />
          </View>
        )}
      </View>

      <View className="mb-2.5 flex-row gap-2">
        <View style={{ flex: 1 }}>
          <DatePicker
            mode="date"
            onChange={(date) => {
              if (!date) {
                return;
              }

              setDraft((current) => ({
                ...current,
                endDate: dateToPlainDate(date, timeZone),
              }));
            }}
            placeholder="End date"
            value={endDatePickerValue}
            variant="outline"
          />
        </View>
        {draft.allDay ? null : (
          <View style={{ flex: 1 }}>
            <DatePicker
              mode="time"
              onChange={(date) => {
                if (!date) {
                  return;
                }

                setDraft((current) => ({
                  ...current,
                  endTime: dateToPlainTime(date, timeZone),
                }));
              }}
              placeholder="End time"
              timeFormat="24"
              value={endTimePickerValue}
              variant="outline"
            />
          </View>
        )}
      </View>

      <View className="mt-2 mb-6 flex-row items-center justify-end gap-2.5">
        {onDelete ? (
          <Button onPress={onDelete} variant="destructive">
            <Text>Delete</Text>
          </Button>
        ) : null}
      </View>
    </BottomSheet>
  );
}

interface CreateEventEditorSheetProps {
  draft: CreateEventDraft;
  isVisible: boolean;
  setDraft: EventDraftUpdater<CreateEventDraft>;
  onClose: () => void;
  onCreate: () => void;
  timeZone: string;
  calendarOptions: CalendarOption[];
  locationSuggestions: LocationSuggestion[];
  showLocationSuggestions: boolean;
  onLocationSuggestionsOpenChange: (isOpen: boolean) => void;
  mapsUrl: string | null;
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
  onAddGoogleMeet: () => void;
}

export function CreateEventEditorSheet(props: CreateEventEditorSheetProps) {
  return (
    <EventEditorSheetBase
      calendarOptions={props.calendarOptions}
      canChangeCalendar
      draft={props.draft}
      isConferencePending={props.isConferencePending}
      isVisible={props.isVisible}
      locationSuggestions={props.locationSuggestions}
      mapsUrl={props.mapsUrl}
      meetingLink={props.meetingLink}
      onAddGoogleMeet={props.onAddGoogleMeet}
      onClose={props.onClose}
      onLocationSuggestionsOpenChange={props.onLocationSuggestionsOpenChange}
      onSubmit={props.onCreate}
      setDraft={props.setDraft}
      showLocationSuggestions={props.showLocationSuggestions}
      submitLabel="Create"
      timeZone={props.timeZone}
      title="New event"
    />
  );
}

interface EditEventEditorSheetProps {
  draft: EditEventDraft;
  isVisible: boolean;
  setDraft: EventDraftUpdater<EditEventDraft>;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  timeZone: string;
  calendarOptions: CalendarOption[];
  locationSuggestions: LocationSuggestion[];
  showLocationSuggestions: boolean;
  onLocationSuggestionsOpenChange: (isOpen: boolean) => void;
  mapsUrl: string | null;
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
  onAddGoogleMeet: () => void;
}

export function EditEventEditorSheet(props: EditEventEditorSheetProps) {
  return (
    <EventEditorSheetBase
      calendarOptions={props.calendarOptions}
      canChangeCalendar={false}
      draft={props.draft}
      isConferencePending={props.isConferencePending}
      isVisible={props.isVisible}
      locationSuggestions={props.locationSuggestions}
      mapsUrl={props.mapsUrl}
      meetingLink={props.meetingLink}
      onAddGoogleMeet={props.onAddGoogleMeet}
      onClose={props.onClose}
      onDelete={props.onDelete}
      onLocationSuggestionsOpenChange={props.onLocationSuggestionsOpenChange}
      onSubmit={props.onSave}
      setDraft={props.setDraft}
      showLocationSuggestions={props.showLocationSuggestions}
      submitLabel="Save"
      timeZone={props.timeZone}
      title="Edit event"
    />
  );
}
