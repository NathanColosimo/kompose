import type { LocationSuggestion } from "@kompose/api/routers/maps/contract";
import {
  canWriteCalendar,
  type Event as GoogleEvent,
  getGoogleEventEditBlockReason,
} from "@kompose/google-cal/schema";
import { untilRuleForDay, untilRuleToDay } from "@kompose/google-cal/until";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@kompose/state/atoms/google-colors";
import {
  describeEventRecurrence,
  monthlyDayOptions,
} from "@kompose/state/event-recurrence-words";
import {
  buildGoogleEventRecurrenceRule,
  dayInZone,
  type EventRecurrenceFrequency,
  type EventRecurrencePattern,
  eventTimeZone,
  followStart,
  GOOGLE_EVENT_WEEKDAYS,
  getPrimaryRecurrenceRule,
  occurrenceDayMoved,
  occurrenceRepeatShown,
  parseGoogleEventRecurrenceRule,
  pickRecurrenceFrequency,
  repeatChanged,
  repeatCountingDay,
  repeatEndsBeforeStart,
  seriesRecurrenceForSave,
  setPrimaryRecurrenceRule,
  timeInZone,
  timeZoneCity,
  untilDefaultDay,
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
  Minus,
  Plus,
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
import {
  Linking,
  Pressable,
  Switch as RNSwitch,
  useWindowDimensions,
  View,
} from "react-native";
import { Temporal } from "temporal-polyfill";
import type {
  CalendarOption,
  EditEventDraft,
  EventDraft,
} from "@/components/calendar/calendar-editor-types";
import {
  dayOf,
  editedStartOf,
  keptSeriesStart,
  savedSeriesRecurrence,
} from "@/components/calendar/series-edit";
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
import { cn } from "@/lib/utils";

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

type RecurrencePatch = Partial<EventRecurrencePattern>;

/** The current rule with `patch` applied; its other parts are kept. */
function buildRecurrenceRuleFromCurrent(
  currentRule: string | undefined,
  patch: RecurrencePatch
): string | null {
  const pattern = parseGoogleEventRecurrenceRule(currentRule);
  return buildGoogleEventRecurrenceRule({ ...pattern, ...patch }, currentRule);
}

/**
 * The Repeat row under the times: how the event repeats, in words, and a
 * tap opens the editor below it. Its own full-width row keeps the date and
 * time pills above it the same widths.
 */
function RecurrenceRow({
  disabled,
  waitingLabel,
  isExpanded,
  onToggle,
  recurrence,
  zoneCity,
  ...editor
}: React.ComponentProps<typeof RecurrenceEditorSection> & {
  /** The occurrence's pattern is still loading. */
  disabled: boolean;
  /**
   * Said in place of "Doesn't repeat" while an occurrence's pattern hasn't
   * loaded: it repeats, but how isn't known yet.
   */
  waitingLabel: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  recurrence: string[];
  /** The series' zone's city when it isn't the app's ("Tokyo"). */
  zoneCity: string | null;
}) {
  const said =
    describeEventRecurrence({
      rules: recurrence,
      start: editor.startDate,
    }) ??
    waitingLabel ??
    "Doesn't repeat";
  // Its days are the series' zone's, not the ones shown here.
  const repeats = zoneCity ? `${said} · ${zoneCity} time` : said;
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

/**
 * The repeat a save for the series would send, and the day its implicit
 * days count from, in the series' zone. Moving an occurrence to another
 * day takes the series' rule along ("weekly on Wed" to "weekly on Thu",
 * `seriesRecurrenceForSave`), so the row says so before the save; a
 * rescheduled occurrence left where it is saves from its place in the
 * series (`keptSeriesStart`), so that's the day its repeat counts from.
 */
function seriesRepeatOf(
  values: Pick<
    EventDraft,
    "allDay" | "recurrence" | "recurrenceEdited" | "startDate" | "startTime"
  >,
  where: {
    appTimeZone: string;
    event: GoogleEvent | undefined;
    /** The series' cached recurrence, for whether the repeat changed. */
    seriesRecurrence: string[] | undefined;
    seriesStart:
      | { date?: string | null; dateTime?: string | null }
      | null
      | undefined;
    seriesTimeZone: string;
  }
): {
  changed: boolean;
  counting: Temporal.PlainDate;
  formDay: Temporal.PlainDate;
  recurrence: string[];
} {
  const { event, seriesTimeZone } = where;
  const editedStart = editedStartOf(values, where.appTimeZone, seriesTimeZone);
  const occurrence = event?.recurringEventId ? event : undefined;
  const formDay = dayOf(
    (occurrence && keptSeriesStart(editedStart, occurrence)) ?? editedStart,
    seriesTimeZone
  );
  // Changed: differs from the series' (a change set back reads as the
  // series' again), the same test as the save's recurrenceToSend.
  const changed = repeatChanged({
    edited: Boolean(values.recurrenceEdited),
    recurrence: values.recurrence,
    source: savedSeriesRecurrence(event, where.seriesRecurrence),
  });
  const moved = Boolean(
    occurrence &&
      occurrenceDayMoved({
        editedStart,
        occurrence,
        timeZone: seriesTimeZone,
      })
  );
  const followed =
    occurrence && moved && !changed
      ? seriesRecurrenceForSave({
          editedStart,
          masterRecurrence: where.seriesRecurrence,
          masterStart: where.seriesStart,
          occurrence,
          recurrence: undefined,
          timeZone: seriesTimeZone,
        })
      : undefined;
  const counting =
    repeatCountingDay({
      // A moved occurrence's series would start again on its new day.
      changed: changed || moved,
      event,
      formDay,
      seriesStart: where.seriesStart,
      timeZone: seriesTimeZone,
    }) ?? formDay;
  return {
    changed,
    counting,
    formDay,
    recurrence: followed ?? values.recurrence,
  };
}

/**
 * The repeat row, or, when the series' rule didn't load, a retry: its
 * repeat can't be edited from a copy that may be old. A copy already shown
 * stays, dimmed, above the retry.
 */
function RepeatSection({
  editor,
  failed,
  hasRule,
  onRetry,
}: {
  editor: React.ReactNode;
  failed: boolean;
  hasRule: boolean;
  onRetry?: () => void;
}) {
  if (!failed) {
    return editor;
  }
  return (
    <>
      {hasRule ? editor : null}
      <Button
        accessibilityHint="Loads the series' repeat again"
        className="mb-2.5"
        onPress={onRetry}
        variant="outline"
      >
        {hasRule
          ? "Repeat didn't refresh · Try again"
          : "Repeat didn't load · Try again"}
      </Button>
    </>
  );
}

const RRULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function RecurrenceEditorSection({
  allDay,
  endFrom,
  parsedRecurrence,
  rule,
  startDate,
  timeZone,
  updateRecurrence,
  applyPrimaryRecurrenceRule,
}: {
  /** An all-day series ends on a date; a timed one after that day. */
  allDay: boolean;
  /**
   * The day an end date defaults from and can't be before: the event's own
   * (an occurrence's, not its series' first, which can be years back).
   */
  endFrom: Temporal.PlainDate;
  parsedRecurrence: EventRecurrencePattern;
  /** The RRULE being edited, for what the pattern alone doesn't say. */
  rule: string | undefined;
  /** Its weekday and day of the month are the series' defaults. */
  startDate: Temporal.PlainDate;
  /** The series' zone, where its end day is counted. */
  timeZone: string;
  updateRecurrence: (patch: RecurrencePatch) => void;
  applyPrimaryRecurrenceRule: (rule: string | null) => void;
}) {
  // With no days picked, a weekly series repeats on the start's weekday.
  const shownDays =
    parsedRecurrence.byDay.length > 0
      ? parsedRecurrence.byDay
      : [RRULE_WEEKDAYS[startDate.dayOfWeek - 1] ?? "MO"];
  return (
    <View className="mb-2.5 rounded-md border border-border px-3 py-2.5">
      {/* Chips at their own width, wrapping (3 + 2 on a phone), as in the
          task editor. */}
      <View className="flex-row flex-wrap gap-2">
        {RECURRENCE_FREQUENCIES.map((frequency) => {
          // A rule the chips can't show (hourly) reads as "none" when
          // parsed, but None isn't picked: tapping it clears the rule.
          const active =
            frequency.value === "none"
              ? !rule
              : parsedRecurrence.freq === frequency.value;
          return (
            <Button
              key={frequency.value}
              onPress={() => {
                // Tapping the picked chip again changes nothing.
                if (active) {
                  return;
                }
                if (frequency.value === "none") {
                  applyPrimaryRecurrenceRule(null);
                  return;
                }
                // Weekly with no days picked repeats on the start's weekday
                // (no BYDAY), so moving the start moves the series with it.
                updateRecurrence(
                  pickRecurrenceFrequency(parsedRecurrence, frequency.value)
                );
              }}
              size="sm"
              style={{ borderRadius: 999 }}
              variant={active ? "default" : "outline"}
            >
              <Text>{frequency.label}</Text>
            </Button>
          );
        })}
      </View>

      {parsedRecurrence.freq === "none" ? null : (
        <IntervalStepper
          freq={parsedRecurrence.freq}
          interval={parsedRecurrence.interval}
          onChange={(interval) => updateRecurrence({ interval })}
        />
      )}

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
                  {/* Two letters, so Saturday and Sunday read apart. */}
                  <Text>{weekday.label.slice(0, 2)}</Text>
                </Button>
              );
            })}
          </View>
        </View>
      ) : null}

      {parsedRecurrence.freq === "MONTHLY" ? (
        <MonthlyDayChoice
          onChange={updateRecurrence}
          pattern={parsedRecurrence}
          rule={rule}
          startDate={startDate}
        />
      ) : null}

      {parsedRecurrence.freq === "none" ? null : (
        <RecurrenceEndSection
          allDay={allDay}
          endFrom={endFrom}
          parsedRecurrence={parsedRecurrence}
          timeZone={timeZone}
          updateRecurrence={updateRecurrence}
        />
      )}
    </View>
  );
}

const UNIT_WORDS: Record<string, [string, string]> = {
  DAILY: ["day", "days"],
  MONTHLY: ["month", "months"],
  WEEKLY: ["week", "weeks"],
  YEARLY: ["year", "years"],
};

/** Round steppers as tall as the number field between them (48pt). */
const STEP_STYLE = {
  borderRadius: 999,
  height: 48,
  paddingHorizontal: 0,
  width: 48,
};

/** "Every − 2 + weeks": how many days, weeks... apart the series repeats. */
function IntervalStepper({
  freq,
  interval,
  onChange,
}: {
  freq: EventRecurrenceFrequency;
  interval: number;
  onChange: (interval: number) => void;
}) {
  const unit = UNIT_WORDS[freq]?.[interval === 1 ? 0 : 1] ?? "";
  return (
    <View className="mt-3 flex-row items-center gap-2">
      <Text className="text-muted-foreground text-xs">Every</Text>
      <Button
        accessibilityLabel="Decrease interval"
        disabled={interval <= 1}
        onPress={() => onChange(interval - 1)}
        size="sm"
        style={STEP_STYLE}
        variant="outline"
      >
        <Icon as={Minus} className="text-foreground" size={14} />
      </Button>
      {/* Typed for a big jump ("every 26 weeks"), stepped for a small one. */}
      <CountInput
        label={`Every how many ${UNIT_WORDS[freq]?.[1] ?? ""}`}
        max={99}
        onValue={onChange}
        value={interval}
      />
      <Button
        accessibilityLabel="Increase interval"
        disabled={interval >= 99}
        onPress={() => onChange(interval + 1)}
        size="sm"
        style={STEP_STYLE}
        variant="outline"
      >
        <Icon as={Plus} className="text-foreground" size={14} />
      </Button>
      <Text className="text-foreground text-sm">{unit}</Text>
    </View>
  );
}

/**
 * Monthly on the start's day, its weekday of the month, or in its last
 * week the last one; a rule set another way comes first, selected.
 */
function MonthlyDayChoice({
  onChange,
  pattern,
  rule,
  startDate,
}: {
  onChange: (patch: RecurrencePatch) => void;
  pattern: EventRecurrencePattern;
  rule: string | undefined;
  startDate: Temporal.PlainDate;
}) {
  return (
    <View className="mt-3">
      <Text className="text-muted-foreground text-xs">On</Text>
      {/* Chips at their own width, wrapping, like the frequency chips. */}
      <View className="mt-1 flex-row flex-wrap gap-2">
        {monthlyDayOptions(pattern, rule, startDate).map((option) => (
          <Button
            accessibilityState={{ selected: option.selected }}
            key={`${option.byDay}|${option.monthDays}`}
            onPress={() => {
              if (!option.selected) {
                onChange({ byDay: option.byDay, monthDays: option.monthDays });
              }
            }}
            size="sm"
            style={{ borderRadius: 999 }}
            variant={option.selected ? "default" : "outline"}
          >
            <Text>{option.label}</Text>
          </Button>
        ))}
      </View>
    </View>
  );
}

const CHIP_STYLE = { borderRadius: 999, flex: 1, paddingHorizontal: 6 };

/** An equal-width chip's label, shrinking only for a large text size. */
function ChipLabel({ children }: { children: string }) {
  return (
    <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1}>
      {children}
    </Text>
  );
}

function RecurrenceEndSection({
  allDay,
  endFrom,
  parsedRecurrence,
  timeZone,
  updateRecurrence,
}: {
  allDay: boolean;
  /** The event's own day: an end date's default and minimum. */
  endFrom: Temporal.PlainDate;
  parsedRecurrence: EventRecurrencePattern;
  /** The series' zone, where its end day is counted. */
  timeZone: string;
  updateRecurrence: (patch: RecurrencePatch) => void;
}) {
  const { end } = parsedRecurrence;
  const untilDay =
    end.type === "until" ? untilRuleToDay(end.date, timeZone) : null;
  return (
    <View className="mt-3">
      <Text className="text-muted-foreground text-xs">Ends</Text>
      {/* Three equal chips in one row. */}
      <View className="mt-1 flex-row gap-1.5">
        <Button
          onPress={() => updateRecurrence({ end: { type: "none" } })}
          size="sm"
          style={CHIP_STYLE}
          variant={end.type === "none" ? "default" : "outline"}
        >
          <ChipLabel>Never</ChipLabel>
        </Button>
        <Button
          onPress={() => {
            if (end.type === "until") {
              return;
            }
            // Three months on from this event (or today).
            updateRecurrence({
              end: {
                date: untilRuleForDay(
                  untilDefaultDay(endFrom, timeZone),
                  allDay,
                  timeZone
                ),
                type: "until",
              },
            });
          }}
          size="sm"
          style={CHIP_STYLE}
          variant={end.type === "until" ? "default" : "outline"}
        >
          <ChipLabel>On date</ChipLabel>
        </Button>
        <Button
          onPress={() => {
            if (end.type !== "count") {
              updateRecurrence({ end: { count: 10, type: "count" } });
            }
          }}
          size="sm"
          style={CHIP_STYLE}
          variant={end.type === "count" ? "default" : "outline"}
        >
          <ChipLabel>After…</ChipLabel>
        </Button>
      </View>

      {end.type === "until" ? (
        <View className="mt-2" style={{ maxWidth: 220 }}>
          <DatePicker
            displayValue={untilDay ? formatPlainDateLong(untilDay) : undefined}
            minimumDate={plainDateToPickerDate(endFrom)}
            mode="date"
            onChange={(date) => {
              if (date) {
                updateRecurrence({
                  end: {
                    date: untilRuleForDay(
                      Temporal.PlainDate.from({
                        day: date.getDate(),
                        month: date.getMonth() + 1,
                        year: date.getFullYear(),
                      }),
                      allDay,
                      timeZone
                    ),
                    type: "until",
                  },
                });
              }
            }}
            placeholder="Until"
            value={untilDay ? plainDateToPickerDate(untilDay) : undefined}
            variant="outline"
          />
        </View>
      ) : null}

      {end.type === "count" ? (
        <View className="mt-2 flex-row items-center gap-2">
          <CountInput
            label="Occurrences"
            onValue={(count) =>
              updateRecurrence({ end: { count, type: "count" } })
            }
            value={end.count}
          />
          <Text className="text-foreground text-xs">
            {end.count === 1 ? "time" : "times"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** "Feb 7, 2027", as on web. */
function formatPlainDateLong(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(plainDateToPickerDate(date));
}

/**
 * A count typed freely: the draft can be empty while editing; only a valid
 * number is passed on, and leaving the field shows the last one.
 */
function CountInput({
  label,
  max = 999,
  onValue,
  value,
}: {
  label: string;
  max?: number;
  onValue: (value: number) => void;
  value: number;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <Input
      accessibilityLabel={label}
      // A narrow field: the Input fills its row otherwise.
      containerStyle={{ width: 64 }}
      inputStyle={{ textAlign: "center" }}
      keyboardType="number-pad"
      onBlur={() => setDraft(null)}
      onChangeText={(text) => {
        const next = text.replace(NON_DIGITS, "");
        setDraft(next);
        const parsed = Number.parseInt(next, 10);
        if (parsed >= 1 && parsed <= max) {
          onValue(parsed);
        }
      }}
      value={draft ?? String(value)}
      variant="outline"
    />
  );
}

const NON_DIGITS = /\D/g;

function EventMeetingButton({
  meetingLink,
  isConferencePending,
  onAddMeeting,
}: {
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
  onAddMeeting: () => void;
}) {
  // The camera grows with the label at larger text sizes (capped).
  const iconSize = Math.round(
    14 * Math.min(useWindowDimensions().fontScale, 2)
  );
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
        <Icon as={Video} className="text-foreground" size={iconSize} />
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
      <Icon as={Video} className="text-foreground" size={iconSize} />
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

/** Why the sheet can't be saved: an end before the start, of it or its repeat. */
function EndsBeforeStartNote({
  endsEarly,
  repeatEndsOn,
}: {
  endsEarly: boolean;
  /** The repeat's end day, when it's before the start. */
  repeatEndsOn: Temporal.PlainDate | null;
}) {
  if (!(endsEarly || repeatEndsOn)) {
    return null;
  }
  // The end is named: it's inside the Repeat row, out of sight.
  return (
    <Text className="-mt-1 mb-2.5 text-destructive text-xs">
      {repeatEndsOn && !endsEarly
        ? `The repeat ends ${formatPlainDateLong(repeatEndsOn)}, before this starts. Pick a later end.`
        : "Ends before it starts."}
    </Text>
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
function describeWhen(draft: EventDraft, timeZone: string): string {
  if (draft.allDay || !(draft.startTime && draft.endTime)) {
    return formatAllDayWhen(draft.startDate, draft.endDate);
  }
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
  recurrence,
  repeatDay,
  timeZone,
}: {
  calendarColor: string | null | undefined;
  calendarLabel: string | undefined;
  draft: EventDraft;
  mapsUrl: string | null;
  meetingLink: MeetingLink | null;
  reason: string;
  /** The series' rules: the form's, kept in step with its master. */
  recurrence: string[];
  /** The day the repeat's implicit days count from (repeatCountingDay). */
  repeatDay: Temporal.PlainDate;
  /** The zone the app shows times in, which the draft's are in. */
  timeZone: string;
}) {
  const location = draft.location.trim();
  const description = draft.description.trim();
  const source = draft.mode === "edit" ? draft.sourceEvent : undefined;
  const repeats = describeEventRecurrence({
    eventType: source?.eventType,
    recurringEventId: source?.recurringEventId,
    rules: recurrence,
    start: repeatDay,
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
          {describeWhen(draft, timeZone)}
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
          // Ink, not a light green: it reads on the cream sheet.
          className={canSubmit ? "text-primary" : "text-muted-foreground"}
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
  // At large text sizes, half the row is too narrow for "Add Meet": stack.
  const stacked = useWindowDimensions().fontScale >= 1.3;
  return (
    <View
      className={
        stacked ? "mb-2.5 gap-2" : "mb-2.5 flex-row items-center gap-2"
      }
    >
      <View
        className={cn(
          "flex-row items-center justify-between rounded-full border border-border px-3 py-2.5",
          stacked ? null : "flex-1"
        )}
      >
        <Text className="font-medium text-foreground text-sm">All day</Text>
        <RNSwitch
          onValueChange={onToggleAllDay}
          thumbColor={allDay ? "#ffffff" : "#f4f3f4"}
          trackColor={{ false: mutedColor, true: switchActiveColor }}
          value={allDay}
        />
      </View>
      <View className={stacked ? undefined : "flex-1 items-end"}>
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
  followsRepeat,
  getValues,
  endDatePickerValue,
  endTimePickerValue,
  setValue,
  startDate,
  startDatePickerValue,
  startTimePickerValue,
  timeZone,
  appTimeZone,
}: {
  allDay: boolean;
  endDate: Temporal.PlainDate;
  endDatePickerValue: Date;
  /**
   * The repeat follows the start ("2nd Tue" to "3rd Wed"). Not for one
   * occurrence: moving it is a reschedule, and its series stays.
   */
  followsRepeat: boolean;
  endTimePickerValue: Date;
  getValues: UseFormGetValues<EventDraft>;
  setValue: UseFormSetValue<EventDraft>;
  startDate: Temporal.PlainDate;
  startDatePickerValue: Date;
  startTimePickerValue: Date;
  /** The series' zone, where its days count. */
  timeZone: string;
  /** The zone the start is shown (and picked) in. */
  appTimeZone: string;
}) {
  // Moving the start keeps the event's length (shared with web).
  const moveStart = (next: {
    date?: Temporal.PlainDate;
    time?: Temporal.PlainTime;
  }) => {
    const before = getValues();
    const moved = moveEventStart(before, next);
    setValue("startDate", moved.startDate, { shouldDirty: true });
    // Days in the series' zone, where its repeat counts them.
    const seriesDay = (
      date: Temporal.PlainDate,
      time: Temporal.PlainTime | null
    ) => dayInZone(date, before.allDay ? null : time, appTimeZone, timeZone);
    const recurrence = followsRepeat
      ? followStart({
          allDay: before.allDay,
          from: seriesDay(before.startDate, before.startTime),
          fromTime: before.allDay
            ? null
            : timeInZone(
                before.startDate,
                before.startTime,
                appTimeZone,
                timeZone
              ),
          recurrence: before.recurrence,
          timeZone,
          to: seriesDay(moved.startDate, moved.startTime),
          toTime: before.allDay
            ? null
            : timeInZone(
                moved.startDate,
                moved.startTime,
                appTimeZone,
                timeZone
              ),
        })
      : before.recurrence;
    if (recurrence !== before.recurrence) {
      setValue("recurrence", recurrence, { shouldDirty: true });
      setValue("recurrenceEdited", true);
    }
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
  /** Loading the occurrence's series pattern failed: offer to try again. */
  masterFailed?: boolean;
  /** The occurrence's series pattern isn't usable yet (loading or failed). */
  masterLoading?: boolean;
  /**
   * The series' pattern when the event is an occurrence; it can load after
   * the editor opens.
   */
  masterRecurrence?: string[];
  /** The series' own start (its master's), once loaded. */
  masterStart?: { date?: string | null; dateTime?: string | null } | null;
  onClose: () => void;
  onDelete?: (draft: EditEventDraft) => void;
  onRetryMaster?: () => void;
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
  masterFailed = false,
  masterLoading = false,
  onRetryMaster,
  masterRecurrence,
  masterStart,
  onClose,
  overlay,
  onSubmit,
  onDelete,
  calendarOptions,
}: EventEditorSheetProps) {
  const appTimeZone = useAtomValue(timezoneAtom);
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

  // While the series' rule isn't usable (fetched again), the repeat
  // controls close: an edit then would keep the old rule.
  React.useEffect(() => {
    if (masterLoading) {
      setIsRecurrenceExpanded(false);
    }
  }, [masterLoading]);

  // An occurrence shows its series' pattern, kept in step as the series
  // loads or is fetched again (a fresher rule after a save replaces the
  // old one), keeping the other edits, unless the user changed the repeat.
  const isOccurrence =
    draft.mode === "edit" && Boolean(draft.sourceEvent.recurringEventId);
  React.useEffect(() => {
    const next = masterRecurrence ?? [];
    if (
      isOccurrence &&
      !masterLoading &&
      !getValues("recurrenceEdited") &&
      next.join("\n") !== getValues("recurrence").join("\n")
    ) {
      setValue("recurrence", next);
    }
  }, [getValues, isOccurrence, masterLoading, masterRecurrence, setValue]);

  const { summary, description, location, allDay } = values;

  const isCreateMode = draft.mode === "create";
  const readOnlyReason = readOnlyReasonFor(draft, calendarOptions);
  const submitLabel = isCreateMode ? "Create" : "Save";
  const sheetTitle = isCreateMode ? "New event" : "Edit event";

  // Any editable event can repeat, a one-off one included. While an
  // occurrence's pattern loads, the control waits: a change made before it
  // arrives would be compared against nothing.
  const recurrenceDisabled = masterLoading;
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
  // An existing series' days (its end day, its start's weekday) count in
  // its own zone; a new event's in the app's.
  const seriesTimeZone = eventTimeZone(sourceEvent, appTimeZone);
  const {
    changed: repeatIsChanged,
    counting: repeatDay,
    formDay,
    recurrence: seriesRepeat,
  } = seriesRepeatOf(values, {
    appTimeZone,
    event: sourceEvent,
    seriesRecurrence: masterRecurrence,
    seriesStart: masterStart,
    seriesTimeZone,
  });
  const shownRepeat = occurrenceRepeatShown({
    edited: Boolean(values.recurrenceEdited),
    recurrence: seriesRepeat,
    seriesRecurrence: masterRecurrence,
    unusable: recurrenceDisabled,
  });
  // The repeat editor starts from what the row shows.
  const primaryRule = getPrimaryRecurrenceRule(seriesRepeat);
  const parsedRecurrence = parseGoogleEventRecurrenceRule(primaryRule);
  // Its end picked, then the start moved past it: say so, and don't save.
  const repeatEndsOn = repeatEndsBeforeStart({
    recurrence: values.recurrence,
    sent: repeatIsChanged,
    startDay: formDay,
    timeZone: seriesTimeZone,
  });
  const canSubmit =
    summary.trim().length > 0 && endsAfterStart(values) && !repeatEndsOn;
  const { meetingLink, isConferencePending } = useEventMeeting({
    conferenceData: values.conferenceData,
    description,
    location,
    sourceEvent,
  });

  const applyPrimaryRecurrenceRule = React.useCallback(
    (rule: string | null) => {
      const nextRecurrence = setPrimaryRecurrenceRule(seriesRepeat, rule);
      setValue("recurrence", nextRecurrence, { shouldDirty: true });
      setValue("recurrenceEdited", true);
    },
    [seriesRepeat, setValue]
  );

  const updateRecurrence = React.useCallback(
    (patch: RecurrencePatch) => {
      const nextRule = buildRecurrenceRuleFromCurrent(primaryRule, patch);
      applyPrimaryRecurrenceRule(nextRule);
    },
    [applyPrimaryRecurrenceRule, primaryRule]
  );

  const recurrenceEditor = (
    <RecurrenceRow
      allDay={values.allDay}
      applyPrimaryRecurrenceRule={applyPrimaryRecurrenceRule}
      disabled={recurrenceDisabled}
      // The day its repeat's implicit days count from, in the series' zone.
      endFrom={formDay}
      isExpanded={isRecurrenceExpanded}
      onToggle={() => setIsRecurrenceExpanded((current) => !current)}
      parsedRecurrence={parsedRecurrence}
      recurrence={shownRepeat.rules}
      rule={primaryRule}
      startDate={repeatDay}
      timeZone={seriesTimeZone}
      updateRecurrence={updateRecurrence}
      // It repeats, but how isn't known yet. (Offline, React Native's
      // queries fail rather than pause, and the row offers a retry.)
      waitingLabel={shownRepeat.loading ? "Loading repeat…" : null}
      zoneCity={
        seriesTimeZone === appTimeZone ? null : timeZoneCity(seriesTimeZone)
      }
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
          recurrence={shownRepeat.rules}
          repeatDay={repeatDay}
          timeZone={appTimeZone}
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
          appTimeZone={appTimeZone}
          endDate={endDate}
          endDatePickerValue={endDatePickerValue}
          endTimePickerValue={endTimePickerValue}
          followsRepeat={!sourceEvent?.recurringEventId}
          getValues={getValues}
          setValue={setValue}
          startDate={startDate}
          startDatePickerValue={startDatePickerValue}
          startTimePickerValue={startTimePickerValue}
          timeZone={seriesTimeZone}
        />
        {/* Save stays off until the end comes after the start; say why. */}
        <EndsBeforeStartNote
          endsEarly={!endsAfterStart(values)}
          repeatEndsOn={repeatEndsOn}
        />

        <RepeatSection
          editor={recurrenceEditor}
          failed={masterFailed}
          // A repeat the user turned off stays shown as off, too.
          hasRule={
            shownRepeat.rules.length > 0 || Boolean(values.recurrenceEdited)
          }
          onRetry={onRetryMaster}
        />

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
