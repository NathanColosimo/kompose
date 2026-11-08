import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { WhoopDaySummary } from "@kompose/api/routers/whoop/contract";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { canWriteCalendar } from "@kompose/google-cal/schema";
import { LINKED_ACCOUNTS_QUERY_KEY } from "@kompose/state/account-query-keys";
import {
  currentDateAtom,
  eventWindowsAtom,
  mobileVisibleDaysAtom,
  mobileVisibleDaysCountAtom,
  timezoneAtom,
} from "@kompose/state/atoms/current-date";
import {
  normalizedGoogleColorsAtomFamily,
  resolveGoogleEventColors,
} from "@kompose/state/atoms/google-colors";
import {
  googleAccountsDataAtom,
  googleCalendarsDataAtom,
  googleCalendarsLoadingAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { isCalendarVisible } from "@kompose/state/atoms/visible-calendars";
import {
  hasWhoopStats,
  shouldShowWhoopRow,
  WHOOP_DAYS_QUERY_KEY,
  whoopAccountIdAtom,
  whoopSummariesByDayAtom,
} from "@kompose/state/atoms/whoop-data";
import {
  calculateCollisionLayout,
  type ItemLayout,
  type PositionedItem,
} from "@kompose/state/collision-utils";
import { eventCreationBlockedReason } from "@kompose/state/event-creation";
import {
  GOOGLE_CALENDARS_QUERY_KEY,
  getGoogleEventsByCalendarQueryKey,
} from "@kompose/state/google-calendar-query-keys";
import {
  eventTimeZone,
  getDefaultRecurrenceScopeForEvent,
  isRecurringGoogleEvent,
  matchUntilToStart,
  occurrenceDayMoved,
  otherTimeZone,
  seriesRecurrenceForSave,
} from "@kompose/state/google-event-recurrence";
import { withEditedTime } from "@kompose/state/google-event-times";
import {
  EVENT_CREATE_FAILURE_MESSAGE,
  SAVE_FAILURE_MESSAGE,
} from "@kompose/state/held-save";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useMoveGoogleEventMutation } from "@kompose/state/hooks/use-move-google-event-mutation";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  allowedEventSaveScope,
  type EventSaveChanges,
  eventSaveDescription,
  eventSaveDisabledScopes,
  RECURRENCE_SCOPE_OPTIONS,
  SCOPE_DIALOG_COPY,
} from "@kompose/state/recurrence-scope-options";
import {
  formatTimeRange,
  nearestSlotMinutes,
  todayPlainDate,
} from "@kompose/state/temporal-utils";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
// biome-ignore lint/performance/noNamespaceImport: expo-haptics is a namespace of functions
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router/stack";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Activity, ChevronLeft, ChevronRight, Eye } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  Alert as RNAlert,
  ScrollView,
  type ScrollViewInstance,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Temporal } from "temporal-polyfill";
import {
  AllDayBlock,
  type BlockDetail,
  EventBlock,
  eventDetails,
  TaskBlock,
} from "@/components/calendar/calendar-blocks";
import type {
  CalendarOption,
  CreateEventDraft,
  EditEventDraft,
  EventDraft,
} from "@/components/calendar/calendar-editor-types";
import { isEditEventDraft } from "@/components/calendar/calendar-editor-types";
import { EventEditorSheet } from "@/components/calendar/calendar-event-editor-sheet";
import { CalendarPickerModal } from "@/components/calendar/calendar-picker-modal";
import { tagIconMap } from "@/components/tags/tag-icon-map";
import {
  type TaskDraft,
  TaskEditorSheet,
} from "@/components/tasks/task-editor-sheet";
import {
  TaskDeleteScopeDialog,
  TaskSaveScopeDialog,
} from "@/components/tasks/task-scope-dialogs";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { RadioGroup } from "@/components/ui/radio";
import { Text } from "@/components/ui/text";
import { useTaskEditorFlow } from "@/hooks/use-task-editor-flow";
import { useColorScheme } from "@/lib/color-scheme-context";

const PIXELS_PER_HOUR = 60;
const MINUTES_STEP = 15;
const DEFAULT_SCROLL_HOUR = 7;
/** All-day chips shown per day before "+N more". */
const MAX_ALL_DAY_CHIPS = 2;
const HOUR_LABEL_CLEARANCE_PX = 10;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
// Swipe thresholds for horizontal navigation without interfering with vertical scroll.
const SWIPE_ACTIVATION_DISTANCE = 16;
const SWIPE_TRIGGER_DISTANCE = 60;
const SWIPE_VERTICAL_TOLERANCE = 12;
const EVENT_BLOCK_INSET_PX = 1;
const TIME_GUTTER_WIDTH_PX = 56;
/** Free strip on the right of each day for tapping to create; wider when there's room. */
function createGutterPt(visibleDays: number): number {
  return visibleDays >= 3 ? 10 : 16;
}
const TIME_GUTTER_LABEL_OFFSET_PX = PIXELS_PER_HOUR / 2;

// --- Temporal helpers ---

function combineDateTime(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string
): Temporal.ZonedDateTime {
  return date.toZonedDateTime({ plainTime: time, timeZone });
}

function minutesFromMidnight(zdt: Temporal.ZonedDateTime): number {
  return zdt.hour * 60 + zdt.minute;
}

function isToday(date: Temporal.PlainDate, timeZone: string): boolean {
  const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
  return Temporal.PlainDate.compare(date, today) === 0;
}

function formatDayHeader(date: Temporal.PlainDate): {
  weekday: string;
  dayNumber: number;
} {
  const weekday = date.toLocaleString(undefined, { weekday: "short" });
  return { dayNumber: date.day, weekday };
}

function calculateTimePosition(timeZone: string): number {
  const now = Temporal.Now.zonedDateTimeISO(timeZone);
  return (now.hour + now.minute / 60) * PIXELS_PER_HOUR;
}

/**
 * The now line runs under the blocks so it never strikes through a title;
 * its dot is drawn on top at the column's edge.
 */
function CurrentTimeIndicator({
  part,
  timeZone,
}: {
  part: "dot" | "line";
  timeZone: string;
}) {
  const [topPosition, setTopPosition] = useState(() =>
    calculateTimePosition(timeZone)
  );

  useEffect(() => {
    setTopPosition(calculateTimePosition(timeZone));
    const interval = setInterval(() => {
      setTopPosition(calculateTimePosition(timeZone));
    }, 60_000);
    return () => clearInterval(interval);
  }, [timeZone]);

  return (
    <View
      className="pointer-events-none absolute right-0 left-0 flex-row items-center"
      // Centered on the time: the dot is 8pt tall, the line 2pt.
      style={{
        top: topPosition,
        transform: [{ translateY: part === "dot" ? -4 : -1 }],
      }}
    >
      {part === "dot" ? (
        <View className="size-2 rounded-full bg-red-500" />
      ) : (
        <View className="h-0.5 flex-1 bg-red-500" />
      )}
    </View>
  );
}

function formatHourLabel(hour: number): string {
  const time = new Temporal.PlainTime(hour, 0);
  return time.toLocaleString(undefined, { hour: "numeric" });
}

function isoStringToZonedDateTime(str: string, timeZone: string) {
  const instant = Temporal.Instant.from(str);
  return instant.toZonedDateTimeISO(timeZone);
}

function calendarLookupKey(accountId: string, calendarId: string): string {
  return `${accountId}:${calendarId}`;
}

type EventDialog = "save" | "delete" | "simple-delete" | null;

interface GoogleEventSource {
  accountId: string;
  calendarBackgroundColor: string | null;
  calendarColorId: string | null;
  calendarForegroundColor: string | null;
  calendarId: string;
  event: GoogleEvent;
}

/** The part of a timed item on one day, for layout. */
interface DaySegment {
  segmentEnd: Temporal.ZonedDateTime;
  segmentStart: Temporal.ZonedDateTime;
}

/**
 * The part of [start, end) on `day`, or null when it doesn't touch that day,
 * so an overnight item shows on both days.
 */
function daySegment(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  day: Temporal.PlainDate,
  timeZone: string
): DaySegment | null {
  const { compare } = Temporal.ZonedDateTime;
  const dayStart = day.toZonedDateTime({ timeZone });
  const dayEnd = dayStart.add({ days: 1 });
  if (compare(end, dayStart) <= 0 || compare(start, dayEnd) >= 0) {
    return null;
  }
  return {
    segmentEnd: compare(end, dayEnd) > 0 ? dayEnd : end,
    segmentStart: compare(start, dayStart) < 0 ? dayStart : start,
  };
}

/** A segment's end in minutes from its day's midnight; 1440 at midnight. */
function segmentEndMinutes({ segmentEnd, segmentStart }: DaySegment): number {
  return segmentEnd.toPlainDate().equals(segmentStart.toPlainDate())
    ? minutesFromMidnight(segmentEnd)
    : 24 * 60;
}

/** Real start and end (for text and editing) plus the part on one day. */
interface PositionedGoogleEvent extends DaySegment {
  end: Temporal.ZonedDateTime;
  source: GoogleEventSource;
  start: Temporal.ZonedDateTime;
}

interface TaskSegment extends DaySegment {
  end: Temporal.ZonedDateTime;
  start: Temporal.ZonedDateTime;
  task: TaskSelectDecoded;
}

interface AllDayGoogleEvent {
  date: Temporal.PlainDate;
  source: GoogleEventSource;
}

function useGoogleEventColors(
  source: GoogleEventSource
): ReturnType<typeof resolveGoogleEventColors> {
  const palette = useAtomValue(
    normalizedGoogleColorsAtomFamily(source.accountId)
  );
  const calendarPaletteColor =
    source.calendarColorId && palette?.calendar
      ? palette.calendar[source.calendarColorId]
      : undefined;
  return resolveGoogleEventColors({
    calendarBackgroundColor:
      source.calendarBackgroundColor ?? calendarPaletteColor?.background,
    calendarForegroundColor:
      source.calendarForegroundColor ?? calendarPaletteColor?.foreground,
    colorId: source.event.colorId,
    palette: palette?.event,
  });
}

function buildCreateTaskDraftFromSlot(
  day: Temporal.PlainDate,
  minutes: number
): TaskDraft {
  const snapped = nearestSlotMinutes(minutes);

  return {
    description: "",
    dueDate: null,
    durationMinutes: 30,
    linkInput: "",
    links: [],
    recurrence: null,
    startDate: day,
    startTime: Temporal.PlainTime.from({
      hour: Math.floor(snapped / 60),
      minute: snapped % 60,
      second: 0,
    }),
    status: "todo",
    tagIds: [],
    title: "",
  };
}

/** The create chooser's line, naming its slot ("… for Sat, Nov 7 at 11:30 AM."). */
function createChooserCopy(
  slot: { day: Temporal.PlainDate; minutes: number } | null,
  timeZone: string
): string | null {
  if (!slot) {
    return null;
  }
  return `Create an event or a scheduled task for ${formatSlot(slot.day, slot.minutes, timeZone)}.`;
}

/** A slot such as "Sat, Nov 7 at 11:30 AM" (the locale's wording). */
function formatSlot(
  day: Temporal.PlainDate,
  minutes: number,
  timeZone: string
): string {
  return day
    .toZonedDateTime({
      plainTime: Temporal.PlainTime.from({
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      }),
      timeZone,
    })
    .toLocaleString(undefined, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      weekday: "short",
    });
}

/** A block's height: at least a 15-minute slot, less the gap between blocks. */
function blockHeight(minutes: number): number {
  const height = Math.max(
    (Math.max(minutes, MINUTES_STEP) / 60) * PIXELS_PER_HOUR,
    24
  );
  return Math.max(height - EVENT_BLOCK_INSET_PX, 20);
}

/** WHOOP workouts use one teal, matching the web's --whoop-workout. */
const WORKOUT_COLOR = {
  dark: "hsl(176, 45%, 50%)",
  light: "hsl(178, 45%, 38%)",
};

interface PositionedWorkout extends DaySegment {
  /** The whole workout's end, for its time text. */
  end: Temporal.ZonedDateTime;
  id: string;
  sportName: string | null;
  start: Temporal.ZonedDateTime;
  strainScore: number | null;
}

/** Each workout's part on `day`, keeping its real start and end for text. */
function workoutSegmentsForDay(
  day: Temporal.PlainDate,
  summaries: Iterable<WhoopDaySummary>,
  timeZone: string
): PositionedWorkout[] {
  const segments: PositionedWorkout[] = [];
  for (const summary of summaries) {
    for (const workout of summary.workouts) {
      const start = isoStringToZonedDateTime(workout.start, timeZone);
      const end = isoStringToZonedDateTime(workout.end, timeZone);
      const segment = daySegment(start, end, day, timeZone);
      if (segment) {
        segments.push({
          ...segment,
          end,
          id: workout.id,
          sportName: workout.sportName,
          start,
          strainScore: workout.strainScore,
        });
      }
    }
  }
  return segments;
}

/** Whether day headers keep a WHOOP row; see shouldShowWhoopRow. */
function useShowWhoopRow(days: Temporal.PlainDate[]): boolean {
  const whoopAccountId = useAtomValue(whoopAccountIdAtom);
  const summaries = useAtomValue(whoopSummariesByDayAtom);
  return shouldShowWhoopRow(
    whoopAccountId,
    days.map((day) => day.toString()),
    summaries
  );
}

/** Recovery green (67–100), yellow (34–66) or red (0–33), as on web. */
function recoveryColor(score: number): string {
  if (score >= 67) {
    return "bg-emerald-500";
  }
  return score >= 34 ? "bg-amber-400" : "bg-red-500";
}

/** The date and any WHOOP numbers, as VoiceOver reads a day header. */
function dayHeaderLabel(
  day: Temporal.PlainDate,
  summary: WhoopDaySummary | undefined,
  isTodayDay: boolean
): string {
  return [
    isTodayDay ? "Today" : null,
    day.toLocaleString(undefined, {
      day: "numeric",
      month: "long",
      weekday: "long",
    }),
    summary?.recoveryScore == null
      ? null
      : `recovery ${summary.recoveryScore}%`,
    summary?.strainScore == null
      ? null
      : `strain ${summary.strainScore.toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Recovery and strain under a day's date. */
function WhoopDayStats({ summary }: { summary: WhoopDaySummary | undefined }) {
  if (!(summary && hasWhoopStats(summary))) {
    // Keep every header the same height.
    return <View className="h-3.5" />;
  }
  // The day header reads these out; see dayHeaderLabel.
  return (
    <View className="h-3.5 flex-row items-center gap-2">
      {summary.recoveryScore === null ? null : (
        <View className="flex-row items-center gap-1">
          <View
            className={`size-1.5 rounded-full ${recoveryColor(summary.recoveryScore)}`}
          />
          <Text className="text-[10px] text-muted-foreground">
            {summary.recoveryScore}%
          </Text>
        </View>
      )}
      {summary.strainScore === null ? null : (
        <View className="flex-row items-center gap-0.5">
          <Icon as={Activity} className="text-muted-foreground" size={10} />
          <Text className="text-[10px] text-muted-foreground">
            {summary.strainScore.toFixed(1)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** An all-day event chip, colored like its timed events. */
function AllDayEventChip({
  item,
  onPress,
}: {
  item: AllDayGoogleEvent;
  onPress: () => void;
}) {
  const { background } = useGoogleEventColors(item.source);
  return (
    <AllDayBlock
      color={background}
      onPress={onPress}
      title={item.source.event.summary || "(No title)"}
    />
  );
}

/** A timed Google event on the grid, tinted with its calendar color. */
function TimedGoogleEventBlock({
  item,
  onPress,
  ...position
}: {
  areaWidth: number;
  columnIndex?: number;
  columnSpan?: number;
  height: number;
  item: PositionedGoogleEvent;
  onLongPressAt?: (offsetY: number) => void;
  onPress: () => void;
  stackDepth?: number;
  uncoveredMinutes?: number;
  top: number;
  totalColumns?: number;
  zIndex?: number;
}) {
  const { background } = useGoogleEventColors(item.source);
  const details = useMemo(
    () => eventDetails(item.source.event),
    [item.source.event]
  );
  return (
    <EventBlock
      {...position}
      color={background}
      details={details}
      end={item.end}
      minutes={Math.round(
        item.segmentEnd.since(item.segmentStart).total({ unit: "minutes" })
      )}
      onPress={onPress}
      start={item.start}
      title={item.source.event.summary || "(No title)"}
    />
  );
}

/** The task's first tag, plus a count of the rest. */
function taskTagDetails(task: TaskSelectDecoded): BlockDetail[] {
  const [first, ...rest] = task.tags;
  if (!first) {
    return [];
  }
  return [
    {
      icon: tagIconMap[first.icon],
      label: rest.length > 0 ? `${first.name} +${rest.length}` : first.name,
    },
  ];
}

/** A day's first all-day chips, then "+N more" for the rest. */
function AllDayCellItems({
  items,
  onMore,
  onOpen,
}: {
  items: AllDayGoogleEvent[];
  onMore: () => void;
  onOpen: (item: AllDayGoogleEvent) => void;
}) {
  return (
    <>
      {items.slice(0, MAX_ALL_DAY_CHIPS).map((item) => (
        <AllDayEventChip
          item={item}
          key={`${item.source.accountId}-${item.source.calendarId}-${item.source.event.id}`}
          onPress={() => onOpen(item)}
        />
      ))}
      {items.length > MAX_ALL_DAY_CHIPS ? (
        <Pressable
          accessibilityRole="button"
          className="rounded px-1 active:bg-muted"
          hitSlop={6}
          onPress={onMore}
        >
          <Text className="text-[10px] text-muted-foreground">
            +{items.length - MAX_ALL_DAY_CHIPS} more
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** Every all-day event on one day, from its "+N more". */
function AllDayListSheet({
  day,
  itemsByDay,
  onClose,
  onDismissed,
  onOpen,
}: {
  day: Temporal.PlainDate | null;
  itemsByDay: Map<string, AllDayGoogleEvent[]>;
  onClose: () => void;
  onDismissed: () => void;
  onOpen: (item: AllDayGoogleEvent) => void;
}) {
  return (
    <BottomSheet
      isVisible={day !== null}
      onClose={onClose}
      onDismissed={onDismissed}
      snapPoints={[0.4, 0.7]}
      title={
        day?.toLocaleString(undefined, {
          day: "numeric",
          month: "long",
          weekday: "long",
        }) ?? "All day"
      }
    >
      <View className="gap-2">
        {(day ? (itemsByDay.get(day.toString()) ?? []) : []).map((item) => (
          <AllDayEventChip
            item={item}
            key={`${item.source.accountId}-${item.source.calendarId}-${item.source.event.id}`}
            onPress={() => onOpen(item)}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

/** A WHOOP workout's details; workouts are read-only in Kompose. */
function WorkoutSheet({
  onClose,
  workout,
}: {
  onClose: () => void;
  workout: PositionedWorkout | null;
}) {
  return (
    <BottomSheet
      isVisible={workout !== null}
      onClose={onClose}
      snapPoints={[0.3]}
      title={workout?.sportName || "Workout"}
    >
      {workout ? (
        <View className="gap-1.5">
          <Text className="text-foreground">
            {formatTimeRange(workout.start, workout.end)}
          </Text>
          {workout.strainScore === null ? null : (
            <Text className="text-foreground">
              Strain {workout.strainScore.toFixed(1)}
            </Text>
          )}
          <Text className="text-muted-foreground text-sm">
            From WHOOP. Edit workouts in the WHOOP app.
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

/**
 * The saved event's series pattern: its own rules, or its master's. Not the
 * draft's, which may add a repeat to a one-off event that isn't a series yet.
 */
function savedSeriesRecurrence(
  draft: EditEventDraft,
  masterRecurrence: string[]
): string[] {
  return draft.sourceEvent.recurrence?.length
    ? draft.sourceEvent.recurrence
    : masterRecurrence;
}

/** An all-day series ends on a date, a timed one on a date-time. */
function matchedRecurrence(
  recurrence: string[] | undefined,
  allDay: boolean,
  timeZone: string
): string[] | undefined {
  return recurrence && matchUntilToStart(recurrence, allDay, timeZone);
}

/**
 * The repeat to send with an event save: only when it changed, so an empty
 * list means "Repeat: None" and leaving it out keeps the series' pattern
 * (also while the master's pattern is still loading).
 */
function recurrenceToSend(
  draft: EventDraft,
  masterRecurrence: string[]
): string[] | undefined {
  if (draft.mode === "create") {
    return draft.recurrence.length > 0 ? draft.recurrence : undefined;
  }
  if (!draft.recurrenceEdited) {
    return undefined;
  }
  const source = draft.sourceEvent.recurrence?.length
    ? draft.sourceEvent.recurrence
    : masterRecurrence;
  return JSON.stringify(draft.recurrence) === JSON.stringify(source)
    ? undefined
    : draft.recurrence;
}

/**
 * Delete confirmations for an event, over its editor: Cancel goes back to the
 * editor with its edits, and Delete holds "Deleting…" until it's done.
 */
function EventDeleteDialogs({
  dialog,
  onCancel,
  onConfirm,
  onScopeChange,
  pending,
  scope,
}: {
  dialog: EventDialog;
  onCancel: () => void;
  onConfirm: (scope: RecurrenceScope) => void;
  onScopeChange: (scope: RecurrenceScope) => void;
  pending: boolean;
  scope: RecurrenceScope;
}) {
  return (
    <>
      <AlertDialog
        closeOnConfirm={false}
        confirmText="Delete"
        description={SCOPE_DIALOG_COPY.deleteEvent.description}
        isVisible={dialog === "delete"}
        onCancel={onCancel}
        onClose={noop}
        onConfirm={() => onConfirm(scope)}
        pending={pending}
        pendingText="Deleting…"
        title={SCOPE_DIALOG_COPY.deleteEvent.title}
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) => onScopeChange(value as RecurrenceScope)}
            options={RECURRENCE_SCOPE_OPTIONS}
            value={scope}
          />
        </View>
      </AlertDialog>
      <AlertDialog
        closeOnConfirm={false}
        confirmText="Delete"
        description="This action cannot be undone."
        isVisible={dialog === "simple-delete"}
        onCancel={onCancel}
        onClose={noop}
        onConfirm={() => onConfirm("this")}
        pending={pending}
        pendingText="Deleting…"
        title="Delete event"
      />
    </>
  );
}

/**
 * Scope for saving a recurring event. It opens over the editor (iOS presents
 * it from the sheet's modal): Cancel goes back to the editor with the edits,
 * and Apply holds "Saving…" until the save ends.
 */
function EventSaveScopeDialog({
  changes,
  isVisible,
  onCancel,
  onConfirm,
  onScopeChange,
  pending,
  scope,
}: {
  /** What the save changes, for the scopes it can use. */
  changes: EventSaveChanges | null;
  isVisible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onScopeChange: (scope: RecurrenceScope) => void;
  pending: boolean;
  scope: RecurrenceScope;
}) {
  const disabled = changes ? eventSaveDisabledScopes(changes) : {};
  return (
    <AlertDialog
      closeOnConfirm={false}
      confirmText="Apply"
      description={
        changes
          ? eventSaveDescription(changes)
          : SCOPE_DIALOG_COPY.saveEvent.description
      }
      isVisible={isVisible}
      onCancel={onCancel}
      // Cancel and a backdrop tap already run onCancel.
      onClose={noop}
      onConfirm={onConfirm}
      pending={pending}
      title={SCOPE_DIALOG_COPY.saveEvent.title}
    >
      <View className="mt-2">
        <RadioGroup
          onValueChange={(value) => onScopeChange(value as RecurrenceScope)}
          options={RECURRENCE_SCOPE_OPTIONS.map((option) => ({
            disabled: Boolean(disabled[option.value]),
            label: option.label,
            value: option.value,
          }))}
          value={scope}
        />
      </View>
    </AlertDialog>
  );
}

function noop() {
  // Intentionally empty: see EventSaveScopeDialog's onClose.
}

export default function CalendarTab() {
  const { isDarkColorScheme } = useColorScheme();
  const queryClient = useQueryClient();
  const { createEvent, updateEvent, deleteEvent } = useGoogleEventMutations();
  const moveEvent = useMoveGoogleEventMutation();

  // Shared atoms for calendar state (mobile variants clamp to 1-3 days).
  const timeZone = useAtomValue(timezoneAtom);
  const setCurrentDate = useSetAtom(currentDateAtom);
  const [visibleDaysCount, setVisibleDaysCount] = useAtom(
    mobileVisibleDaysCountAtom
  );
  const visibleDays = useAtomValue(mobileVisibleDaysAtom);
  const windows = useAtomValue(eventWindowsAtom);

  // Tasks: use the same query source as mutations to avoid stale editor state.
  const { tasksQuery, updateTask } = useTasks();
  const tasks = tasksQuery.data ?? [];

  const scheduledTasks = useMemo(
    () => tasks.filter((t) => t.startDate !== null && t.startTime !== null),
    [tasks]
  );

  const googleCalendars = useAtomValue(googleCalendarsDataAtom);
  const googleAccounts = useAtomValue(googleAccountsDataAtom);
  const isLoadingCalendars = useAtomValue(googleCalendarsLoadingAtom);
  const calendarMetadataByKey = useMemo(() => {
    const metadata = new Map<
      string,
      {
        colorId: string | null;
        backgroundColor: string | null;
        foregroundColor: string | null;
      }
    >();

    for (const entry of googleCalendars) {
      metadata.set(calendarLookupKey(entry.accountId, entry.calendar.id), {
        backgroundColor: entry.calendar.backgroundColor ?? null,
        colorId: entry.calendar.colorId ?? null,
        foregroundColor: entry.calendar.foregroundColor ?? null,
      });
    }

    return metadata;
  }, [googleCalendars]);

  const visibleCalendarIds = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const isFetchingAccounts = useIsFetching({
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
  });
  const isFetchingCalendars = useIsFetching({
    queryKey: GOOGLE_CALENDARS_QUERY_KEY,
  });
  const isFetchingWhoop = useIsFetching({ queryKey: WHOOP_DAYS_QUERY_KEY });

  const { events: googleEvents, isFetching: isFetchingGoogleEvents } =
    useGoogleEvents({
      visibleCalendars: visibleCalendarIds,
      windows,
    });

  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const whoopSummaries = useAtomValue(whoopSummariesByDayAtom);
  // "Nov", or "Oct–Nov" when the visible days cross a month.
  const firstMonth = visibleDays[0]?.toLocaleString(undefined, {
    month: "short",
  });
  const lastMonth = visibleDays.at(-1)?.toLocaleString(undefined, {
    month: "short",
  });
  const gutterMonths =
    firstMonth === lastMonth ? firstMonth : `${firstMonth}–${lastMonth}`;
  const showWhoopRow = useShowWhoopRow(visibleDays);
  // Each day's block area, less the time gutter, borders, and create strip.
  const { width: windowWidth } = useWindowDimensions();
  const blockAreaWidth =
    (windowWidth - TIME_GUTTER_WIDTH_PX) / Math.max(visibleDays.length, 1) -
    1 -
    createGutterPt(visibleDays.length);
  // Each workout's part on every visible day it touches, so an overnight
  // workout shows on both days with its real times.
  const workoutsByDay = useMemo(
    () =>
      new Map(
        visibleDays.map((day) => [
          day.toString(),
          workoutSegmentsForDay(day, whoopSummaries.values(), timeZone),
        ])
      ),
    [visibleDays, whoopSummaries, timeZone]
  );

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: MVP grouping logic kept inline for now.
  const { timedEventsByDay, allDayEventsByDay } = useMemo(() => {
    const timed = new Map<string, PositionedGoogleEvent[]>();
    const allDay = new Map<string, AllDayGoogleEvent[]>();

    for (const day of visibleDays) {
      const key = day.toString();
      timed.set(key, []);
      allDay.set(key, []);
    }

    for (const item of googleEvents) {
      const calendarMetadata = calendarMetadataByKey.get(
        calendarLookupKey(item.accountId, item.calendarId)
      );
      const source = {
        accountId: item.accountId,
        calendarBackgroundColor: calendarMetadata?.backgroundColor ?? null,
        calendarColorId: calendarMetadata?.colorId ?? null,
        calendarForegroundColor: calendarMetadata?.foregroundColor ?? null,
        calendarId: item.calendarId,
        event: item.event,
      };
      const startDate = item.event.start.date;
      const startDateTime = item.event.start.dateTime;
      const endDateTime = item.event.end.dateTime;

      if (startDate && !startDateTime && !endDateTime) {
        // End dates are exclusive: a trip from the 11th to the 13th shows
        // on the 11th and 12th.
        const date = Temporal.PlainDate.from(startDate);
        const endDate = item.event.end.date
          ? Temporal.PlainDate.from(item.event.end.date)
          : date.add({ days: 1 });
        for (const day of visibleDays) {
          if (
            Temporal.PlainDate.compare(day, date) >= 0 &&
            Temporal.PlainDate.compare(day, endDate) < 0
          ) {
            allDay.get(day.toString())?.push({ date, source });
          }
        }
        continue;
      }

      const startStr = item.event.start.dateTime ?? item.event.start.date;
      const endStr = item.event.end.dateTime ?? item.event.end.date;
      if (!(startStr && endStr)) {
        continue;
      }
      if (!(startStr.includes("T") && endStr.includes("T"))) {
        continue;
      }

      try {
        const start = isoStringToZonedDateTime(startStr, timeZone);
        const end = isoStringToZonedDateTime(endStr, timeZone);
        for (const day of visibleDays) {
          const segment = daySegment(start, end, day, timeZone);
          if (segment) {
            timed.get(day.toString())?.push({ ...segment, end, source, start });
          }
        }
      } catch {
        // Skip unparseable events.
      }
    }

    return { allDayEventsByDay: allDay, timedEventsByDay: timed };
  }, [calendarMetadataByKey, googleEvents, timeZone, visibleDays]);

  // Each scheduled task's part on every visible day it touches.
  const taskSegmentsByDay = useMemo(() => {
    const map = new Map<string, TaskSegment[]>();
    for (const day of visibleDays) {
      map.set(day.toString(), []);
    }
    for (const task of scheduledTasks) {
      if (!(task.startDate && task.startTime)) {
        continue;
      }
      const start = task.startDate.toZonedDateTime({
        plainTime: task.startTime,
        timeZone,
      });
      const end = start.add({
        minutes: Math.max(MINUTES_STEP, task.durationMinutes),
      });
      for (const day of visibleDays) {
        const segment = daySegment(start, end, day, timeZone);
        if (segment) {
          map.get(day.toString())?.push({ ...segment, end, start, task });
        }
      }
    }
    return map;
  }, [scheduledTasks, timeZone, visibleDays]);

  // Calculate collision layouts for all visible days (tasks + google events combined).
  const collisionLayoutsByDay = useMemo(() => {
    const layoutsByDay = new Map<string, Map<string, ItemLayout>>();

    for (const day of visibleDays) {
      const dayKey = day.toString();
      const taskItems: PositionedItem[] = (
        taskSegmentsByDay.get(dayKey) ?? []
      ).map((segment) => ({
        endMinutes: segmentEndMinutes(segment),
        id: segment.task.id,
        startMinutes: minutesFromMidnight(segment.segmentStart),
        type: "task" as const,
      }));

      const googleItems: PositionedItem[] = (
        timedEventsByDay.get(dayKey) ?? []
      ).map((ge) => ({
        endMinutes: segmentEndMinutes(ge),
        id: `${ge.source.accountId}-${ge.source.calendarId}-${ge.source.event.id}`,
        startMinutes: minutesFromMidnight(ge.segmentStart),
        type: "google-event" as const,
      }));

      const workoutItems: PositionedItem[] = (
        workoutsByDay.get(dayKey) ?? []
      ).map((workout) => ({
        endMinutes: segmentEndMinutes(workout),
        id: `whoop-${workout.id}`,
        startMinutes: minutesFromMidnight(workout.segmentStart),
        type: "whoop-workout" as const,
      }));

      const allItems = [...taskItems, ...googleItems, ...workoutItems];
      // Blocks are at least 24pt tall (blockHeight), 24 minutes at 60pt an hour.
      const layout = calculateCollisionLayout(allItems, {
        minDrawnMinutes: 24,
      });
      layoutsByDay.set(dayKey, layout);
    }

    return layoutsByDay;
  }, [visibleDays, taskSegmentsByDay, timedEventsByDay, workoutsByDay]);

  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const editingEventDraft =
    eventDraft && isEditEventDraft(eventDraft) ? eventDraft : null;
  const recurringMasterEvent = useRecurringEventMaster({
    accountId: editingEventDraft?.sourceCalendar.accountId ?? "",
    calendarId: editingEventDraft?.sourceCalendar.calendarId ?? "",
    enabled: Boolean(editingEventDraft),
    event: editingEventDraft?.sourceEvent ?? null,
  });
  const masterRecurrence = recurringMasterEvent.data?.recurrence ?? [];
  const [eventSaveScope, setEventSaveScope] = useState<RecurrenceScope>("this");
  const [eventDeleteScope, setEventDeleteScope] =
    useState<RecurrenceScope>("this");
  const [eventDialog, setEventDialog] = useState<EventDialog>(null);
  const [pendingEventSaveDraft, setPendingEventSaveDraft] =
    useState<EditEventDraft | null>(null);
  const [pendingEventDeleteDraft, setPendingEventDeleteDraft] =
    useState<EditEventDraft | null>(null);

  const showEventEditor = useCallback((draft: EventDraft | null) => {
    setEventDialog(null);
    setPendingEventSaveDraft(null);
    setPendingEventDeleteDraft(null);
    setEventDraft(draft);
  }, []);

  const closeEventModal = useCallback(() => {
    showEventEditor(null);
  }, [showEventEditor]);

  const taskFlow = useTaskEditorFlow();
  const openCreateTask = taskFlow.openCreate;
  // The event picked from that list, opened once the list has closed.
  const [pendingAllDayEdit, setPendingAllDayEdit] =
    useState<AllDayGoogleEvent | null>(null);
  // The day whose full all-day list is open, from "+N more".
  const [allDayListDay, setAllDayListDay] = useState<Temporal.PlainDate | null>(
    null
  );
  // The WHOOP workout whose details are open; workouts are read-only.
  const [openWorkout, setOpenWorkout] = useState<PositionedWorkout | null>(
    null
  );
  const [createSlotSelection, setCreateSlotSelection] = useState<{
    day: Temporal.PlainDate;
    minutes: number;
  } | null>(null);
  // The chooser sheet animates out after the slot clears; its line keeps
  // the last slot so it doesn't vanish mid-exit.
  const [lastCreateSlot, setLastCreateSlot] =
    useState<typeof createSlotSelection>(null);
  const shownCreateSlot = createSlotSelection ?? lastCreateSlot;
  const [pendingCreateAction, setPendingCreateAction] = useState<{
    kind: "event" | "task";
    day: Temporal.PlainDate;
    minutes: number;
  } | null>(null);

  const allCalendarOptions = useMemo<CalendarOption[]>(
    () =>
      googleCalendars.map((calendar) => ({
        accessRole: calendar.calendar.accessRole ?? null,
        accountId: calendar.accountId,
        calendarId: calendar.calendar.id,
        color: calendar.calendar.backgroundColor ?? null,
        label: calendar.calendar.summary ?? "Calendar",
      })),
    [googleCalendars]
  );
  const visibleCalendarOptions = useMemo(
    () =>
      allCalendarOptions.filter((option) =>
        isCalendarVisible(
          visibleCalendarIds,
          option.accountId,
          option.calendarId
        )
      ),
    [allCalendarOptions, visibleCalendarIds]
  );

  // New events go to a shown calendar the user can write to, so they don't
  // land somewhere hidden (as on web).
  const defaultCalendar = visibleCalendarOptions.find((option) =>
    canWriteCalendar(option.accessRole)
  );
  // Editing keeps the event within its account; creating can use any calendar.
  const eventCalendarOptions = useMemo(() => {
    if (!editingEventDraft) {
      return allCalendarOptions;
    }
    return allCalendarOptions.filter(
      (option) =>
        option.accountId === editingEventDraft.sourceCalendar.accountId
    );
  }, [allCalendarOptions, editingEventDraft]);
  const goToPrevious = useCallback(() => {
    setCurrentDate((d) => d.subtract({ days: visibleDaysCount }));
  }, [setCurrentDate, visibleDaysCount]);

  const goToNext = useCallback(() => {
    setCurrentDate((d) => d.add({ days: visibleDaysCount }));
  }, [setCurrentDate, visibleDaysCount]);

  const goToToday = useCallback(() => {
    setCurrentDate(todayPlainDate(timeZone));
  }, [setCurrentDate, timeZone]);

  // Horizontal swipe gesture for navigating between day sets.
  // .runOnJS(true) runs handlers on JS thread for state updates.
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-SWIPE_ACTIVATION_DISTANCE, SWIPE_ACTIVATION_DISTANCE])
        .failOffsetY([-SWIPE_VERTICAL_TOLERANCE, SWIPE_VERTICAL_TOLERANCE])
        .onEnd((event) => {
          if (event.translationX <= -SWIPE_TRIGGER_DISTANCE) {
            goToNext();
          } else if (event.translationX >= SWIPE_TRIGGER_DISTANCE) {
            goToPrevious();
          }
        }),
    [goToNext, goToPrevious]
  );

  const openCreateEventAt = useCallback(
    (day: Temporal.PlainDate, minutes: number) => {
      if (!defaultCalendar) {
        return;
      }
      const snapped = nearestSlotMinutes(minutes);
      const startTime = Temporal.PlainTime.from({
        hour: Math.floor(snapped / 60),
        minute: snapped % 60,
        second: 0,
      });
      // 30 minutes, onto the next day from 11:45 PM.
      const end = day.toPlainDateTime(startTime).add({ minutes: 30 });
      const createDraft: CreateEventDraft = {
        allDay: false,
        calendar: {
          accountId: defaultCalendar.accountId,
          calendarId: defaultCalendar.calendarId,
        },
        colorId: null,
        conferenceData: null,
        description: "",
        endDate: end.toPlainDate(),
        endTime: end.toPlainTime(),
        location: "",
        mode: "create",
        recurrence: [],
        startDate: day,
        startTime,
        summary: "",
      };
      showEventEditor(createDraft);
    },
    [defaultCalendar, showEventEditor]
  );

  const openCreateTaskAt = useCallback(
    (day: Temporal.PlainDate, minutes: number) => {
      openCreateTask(buildCreateTaskDraftFromSlot(day, minutes));
    },
    [openCreateTask]
  );

  const openCreateChooserAt = useCallback(
    (day: Temporal.PlainDate, minutes: number) => {
      const slot = { day, minutes: nearestSlotMinutes(minutes) };
      // A fresh chooser drops any action left from one iOS never dismissed.
      setPendingCreateAction(null);
      setCreateSlotSelection(slot);
      setLastCreateSlot(slot);
    },
    []
  );

  // VoiceOver can't tap an empty slot, so each day header offers the create
  // chooser: today at the next half hour, other days at 9 AM.
  const openCreateChooserForDay = useCallback(
    (day: Temporal.PlainDate) => {
      const now = Temporal.Now.zonedDateTimeISO(timeZone);
      if (day.equals(now.toPlainDate())) {
        // Late at night this clamps to 11:30 PM, the last slot of the day.
        const nextHalfHour = Math.ceil((now.hour * 60 + now.minute) / 30) * 30;
        openCreateChooserAt(day, Math.min(nextHalfHour, 23 * 60 + 30));
      } else {
        openCreateChooserAt(day, 9 * 60);
      }
    },
    [openCreateChooserAt, timeZone]
  );

  const toggleTaskDone = useCallback(
    (task: TaskSelectDecoded) =>
      updateTask.mutate({
        id: task.id,
        scope: "this",
        task: { status: task.status === "done" ? "todo" : "done" },
      }),
    [updateTask]
  );

  // A long press on a block offers that block's actions and creating at the
  // pressed time, so the gesture never does something you can't see coming.
  const showBlockMenu = useCallback(
    ({
      day,
      done,
      offsetY,
      onOpen,
      onToggleDone,
      title,
    }: {
      day: Temporal.PlainDate;
      done?: boolean;
      offsetY: number;
      onOpen?: () => void;
      onToggleDone?: () => void;
      title: string;
    }) => {
      Haptics.selectionAsync().catch(() => undefined);
      const minutes = nearestSlotMinutes((offsetY / PIXELS_PER_HOUR) * 60);
      const time = Temporal.PlainTime.from({
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      }).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
      const actions: { label: string; run: () => void }[] = [];
      if (onOpen) {
        actions.push({ label: "Open", run: onOpen });
      }
      if (onToggleDone) {
        actions.push({
          label: done ? "Mark as not done" : "Mark as done",
          run: onToggleDone,
        });
      }
      actions.push({
        label: `New event or task at ${time}`,
        run: () => openCreateChooserAt(day, minutes),
      });
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            cancelButtonIndex: actions.length,
            options: [...actions.map((action) => action.label), "Cancel"],
            title,
          },
          (index) => actions[index]?.run()
        );
        return;
      }
      RNAlert.alert(title, undefined, [
        ...actions.map((action) => ({
          onPress: action.run,
          text: action.label,
        })),
        { style: "cancel" as const, text: "Cancel" },
      ]);
    },
    [openCreateChooserAt]
  );

  const closeCreateChooser = useCallback(() => {
    setCreateSlotSelection(null);
  }, []);

  // Runs the chosen create action once the chooser's modal is gone; a modal
  // presented while another dismisses is swallowed on iOS.
  const runPendingCreateAction = useCallback(() => {
    if (pendingCreateAction === null) {
      return;
    }
    if (pendingCreateAction.kind === "event") {
      openCreateEventAt(pendingCreateAction.day, pendingCreateAction.minutes);
    } else {
      openCreateTaskAt(pendingCreateAction.day, pendingCreateAction.minutes);
    }
    setPendingCreateAction(null);
  }, [openCreateEventAt, openCreateTaskAt, pendingCreateAction]);

  const openEditTimedEvent = useCallback(
    (item: PositionedGoogleEvent) => {
      const editDraft: EditEventDraft = {
        allDay: false,
        calendar: {
          accountId: item.source.accountId,
          calendarId: item.source.calendarId,
        },
        colorId: item.source.event.colorId ?? null,
        conferenceData: item.source.event.conferenceData ?? null,
        description: item.source.event.description ?? "",
        endDate: item.end.toPlainDate(),
        endTime: item.end.toPlainTime(),
        eventId: item.source.event.id,
        location: item.source.event.location ?? "",
        mode: "edit",
        recurrence: item.source.event.recurrence ?? [],
        sourceCalendar: {
          accountId: item.source.accountId,
          calendarId: item.source.calendarId,
        },
        sourceEvent: item.source.event,
        startDate: item.start.toPlainDate(),
        startTime: item.start.toPlainTime(),
        summary: item.source.event.summary ?? "",
      };
      showEventEditor(editDraft);
    },
    [showEventEditor]
  );

  const openEditAllDayEvent = useCallback(
    (item: AllDayGoogleEvent) => {
      const startDate = item.source.event.start.date
        ? Temporal.PlainDate.from(item.source.event.start.date)
        : item.date;
      // Google all-day events use exclusive end dates.
      const endDateExclusive = item.source.event.end.date;
      const rawEndDate = endDateExclusive
        ? Temporal.PlainDate.from(endDateExclusive).subtract({ days: 1 })
        : startDate;
      const endDate =
        Temporal.PlainDate.compare(rawEndDate, startDate) < 0
          ? startDate
          : rawEndDate;

      const editDraft: EditEventDraft = {
        allDay: true,
        calendar: {
          accountId: item.source.accountId,
          calendarId: item.source.calendarId,
        },
        colorId: item.source.event.colorId ?? null,
        conferenceData: item.source.event.conferenceData ?? null,
        description: item.source.event.description ?? "",
        endDate,
        endTime: null,
        eventId: item.source.event.id,
        location: item.source.event.location ?? "",
        mode: "edit",
        recurrence: item.source.event.recurrence ?? [],
        sourceCalendar: {
          accountId: item.source.accountId,
          calendarId: item.source.calendarId,
        },
        sourceEvent: item.source.event,
        startDate,
        startTime: null,
        summary: item.source.event.summary ?? "",
      };
      showEventEditor(editDraft);
    },
    [showEventEditor]
  );

  const buildEventPayload = useCallback(
    (currentDraft: EventDraft) => {
      let startPayload: { date?: string; dateTime?: string; timeZone?: string };
      let endPayload: { date?: string; dateTime?: string; timeZone?: string };

      if (currentDraft.allDay) {
        startPayload = { date: currentDraft.startDate.toString() };
        endPayload = { date: currentDraft.endDate.add({ days: 1 }).toString() };
      } else {
        const startZdt = combineDateTime(
          currentDraft.startDate,
          currentDraft.startTime ?? Temporal.PlainTime.from("09:00"),
          timeZone
        );
        const endZdt = combineDateTime(
          currentDraft.endDate,
          currentDraft.endTime ?? Temporal.PlainTime.from("10:00"),
          timeZone
        );
        // An existing event keeps its own zone (Google repeats a series
        // in its start's zone); a new one takes the app's.
        const zone = eventTimeZone(
          currentDraft.mode === "edit" ? currentDraft.sourceEvent : undefined,
          timeZone
        );
        startPayload = {
          dateTime: startZdt.toInstant().toString(),
          timeZone: zone,
        };
        endPayload = {
          dateTime: endZdt.toInstant().toString(),
          timeZone: zone,
        };
      }

      return {
        colorId: currentDraft.colorId ?? undefined,
        conferenceData: currentDraft.conferenceData ?? undefined,
        description: currentDraft.description.trim() || undefined,
        end: endPayload,
        location: currentDraft.location.trim() || undefined,
        recurrence: matchedRecurrence(
          recurrenceToSend(currentDraft, masterRecurrence),
          currentDraft.allDay,
          timeZone
        ),
        start: startPayload,
        summary: currentDraft.summary.trim(),
      };
    },
    [masterRecurrence, timeZone]
  );

  const commitEventUpdate = useCallback(
    async (draft: EditEventDraft, scope: RecurrenceScope) => {
      const sourceCalendar = draft.sourceCalendar;
      const destinationCalendarId =
        draft.calendar.calendarId === sourceCalendar.calendarId
          ? null
          : draft.calendar.calendarId;
      const eventPayload = buildEventPayload(draft);
      // A moved date carries the series' rule along, for the series.
      const recurrence =
        scope === "this"
          ? eventPayload.recurrence
          : (eventPayload.recurrence ??
            seriesRecurrenceForSave({
              editedStart: eventPayload.start,
              masterRecurrence,
              occurrence: draft.sourceEvent,
              recurrence: eventPayload.recurrence,
              timeZone,
            }));
      await updateEvent.mutateAsync({
        accountId: sourceCalendar.accountId,
        calendarId: sourceCalendar.calendarId,
        failureMessage: SAVE_FAILURE_MESSAGE,
        // The editor holds on the save; the cache changes once it's in.
        optimistic: false,
        event: {
          ...draft.sourceEvent,
          ...eventPayload,
          recurrence,
          end: withEditedTime(draft.sourceEvent.end, eventPayload.end),
          start: withEditedTime(draft.sourceEvent.start, eventPayload.start),
        },
        eventId: draft.eventId,
        recurrenceScope: scope,
      });

      if (destinationCalendarId) {
        await moveEvent.mutateAsync({
          accountId: sourceCalendar.accountId,
          calendarId: sourceCalendar.calendarId,
          destinationCalendarId,
          eventId: draft.eventId,
          scope,
        });
      }

      closeEventModal();
    },
    [
      buildEventPayload,
      closeEventModal,
      masterRecurrence,
      moveEvent,
      timeZone,
      updateEvent,
    ]
  );

  /** What a save changes, for the scopes its dialog offers. */
  const eventSaveChanges = useCallback(
    (draft: EditEventDraft): EventSaveChanges => ({
      calendarChanged:
        draft.calendar.calendarId !== draft.sourceCalendar.calendarId,
      dateMoved: occurrenceDayMoved({
        editedStart: buildEventPayload(draft).start,
        occurrence: draft.sourceEvent,
        timeZone,
      }),
      patternChanged: recurrenceToSend(draft, masterRecurrence) !== undefined,
      seriesRuleFailed: recurringMasterEvent.isError,
      seriesRuleLoaded: Boolean(
        draft.sourceEvent.recurrence?.length || recurringMasterEvent.data
      ),
      seriesTimeZone: otherTimeZone(draft.sourceEvent, timeZone),
    }),
    [
      buildEventPayload,
      masterRecurrence,
      recurringMasterEvent.data,
      recurringMasterEvent.isError,
      timeZone,
    ]
  );

  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const saveEvent = useCallback(
    async (draft: EventDraft) => {
      if (!draft.summary.trim()) {
        return;
      }

      if (draft.mode === "create") {
        await createEvent.mutateAsync({
          accountId: draft.calendar.accountId,
          calendarId: draft.calendar.calendarId,
          failureMessage: EVENT_CREATE_FAILURE_MESSAGE,
          event: buildEventPayload(draft),
        });
        closeEventModal();
        return;
      }

      const masterSeriesRecurrence = savedSeriesRecurrence(
        draft,
        masterRecurrence
      );
      const recurring =
        isRecurringGoogleEvent({
          event: draft.sourceEvent,
          masterRecurrence: masterSeriesRecurrence,
        }) || Boolean(draft.sourceEvent.originalStartTime);

      if (recurring) {
        const changes = eventSaveChanges(draft);
        // A calendar move applies to the whole series; one occurrence can't
        // repeat differently from its series.
        const suggested = changes.calendarChanged
          ? "all"
          : getDefaultRecurrenceScopeForEvent({
              event: draft.sourceEvent,
              masterRecurrence: masterSeriesRecurrence,
            });
        const defaultScope = allowedEventSaveScope(
          suggested === "this" && changes.patternChanged
            ? "following"
            : suggested,
          eventSaveDisabledScopes(changes)
        );
        // The scope dialog opens over the editor, which stays open.
        setPendingEventSaveDraft(draft);
        setEventSaveScope(defaultScope);
        setEventDialog("save");
        return;
      }

      await commitEventUpdate(draft, "this");
    },
    [
      buildEventPayload,
      closeEventModal,
      commitEventUpdate,
      createEvent,
      eventSaveChanges,
      masterRecurrence,
    ]
  );

  const confirmScopedEventSave = useCallback(async () => {
    if (!pendingEventSaveDraft) {
      return;
    }
    Keyboard.dismiss();
    setIsSavingEvent(true);
    try {
      // Closes the editor (and this dialog) when it saves.
      await commitEventUpdate(pendingEventSaveDraft, eventSaveScope);
    } catch {
      // The mutation reports the error; the editor stays with the edits.
      setEventDialog(null);
      setPendingEventSaveDraft(null);
    } finally {
      setIsSavingEvent(false);
    }
  }, [commitEventUpdate, eventSaveScope, pendingEventSaveDraft]);

  const requestDeleteEvent = useCallback(
    (draft: EditEventDraft) => {
      const recurringMasterRecurrence = savedSeriesRecurrence(
        draft,
        masterRecurrence
      );
      const recurring =
        isRecurringGoogleEvent({
          event: draft.sourceEvent,
          masterRecurrence: recurringMasterRecurrence,
        }) || Boolean(draft.sourceEvent.originalStartTime);

      // The dialog opens over the editor, which stays open: Cancel goes back
      // to it with the edits, and a failed delete leaves it.
      setPendingEventDeleteDraft(draft);

      if (recurring) {
        setEventDeleteScope(
          getDefaultRecurrenceScopeForEvent({
            event: draft.sourceEvent,
            masterRecurrence: recurringMasterRecurrence,
          })
        );
        setEventDialog("delete");
        return;
      }

      setEventDialog("simple-delete");
    },
    [masterRecurrence]
  );

  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const confirmEventDelete = useCallback(
    async (scope: RecurrenceScope) => {
      if (!pendingEventDeleteDraft) {
        return;
      }

      setIsDeletingEvent(true);
      try {
        await deleteEvent.mutateAsync({
          accountId: pendingEventDeleteDraft.sourceCalendar.accountId,
          calendarId: pendingEventDeleteDraft.sourceCalendar.calendarId,
          eventId: pendingEventDeleteDraft.eventId,
          scope,
        });
        closeEventModal();
      } catch {
        // The mutation reports the error; the editor stays.
        setEventDialog(null);
        setPendingEventDeleteDraft(null);
      } finally {
        setIsDeletingEvent(false);
      }
    },
    [closeEventModal, deleteEvent, pendingEventDeleteDraft]
  );

  const totalHeight = 24 * PIXELS_PER_HOUR;
  const scrollRef = useRef<ScrollViewInstance>(null);

  // Track scroll position so we can restore it after a pull-to-refresh.
  // Stop a little above the hour so its whole gutter label shows.
  const scrollOffsetRef = useRef(
    DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR - HOUR_LABEL_CLEARANCE_PX
  );
  const isRefreshingRef = useRef(false);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
    },
    []
  );

  // True only during an explicit pull-to-refresh, so background fetches
  // (e.g. task mutations, realtime sync) don't trigger the RefreshControl spinner.
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const refreshCalendarData = useCallback(() => {
    setIsPullRefreshing(true);
    tasksQuery.refetch();
    queryClient.invalidateQueries({
      queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    });
    queryClient.invalidateQueries({
      queryKey: GOOGLE_CALENDARS_QUERY_KEY,
    });
    queryClient.invalidateQueries({ queryKey: WHOOP_DAYS_QUERY_KEY });

    // Invalidate visible calendars; active month queries include preloaded days.
    for (const calendar of visibleCalendarIds) {
      queryClient.invalidateQueries({
        queryKey: getGoogleEventsByCalendarQueryKey(calendar),
      });
    }
  }, [queryClient, tasksQuery, visibleCalendarIds]);

  const isRefreshing =
    tasksQuery.isFetching ||
    isFetchingGoogleEvents ||
    isFetchingAccounts > 0 ||
    isFetchingCalendars > 0 ||
    isFetchingWhoop > 0;

  // Clear the pull-to-refresh indicator and restore scroll position once
  // all fetches settle.
  useEffect(() => {
    if (isRefreshingRef.current && !isRefreshing) {
      setIsPullRefreshing(false);
      scrollRef.current?.scrollTo({
        animated: false,
        y: scrollOffsetRef.current,
      });
    }
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  // Defer the initial 7 AM scroll until the time grid has laid out.
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        animated: false,
        y: scrollOffsetRef.current,
      });
    });
  }, []);

  function dismissEventSaveDialog() {
    setEventDialog(null);
    setPendingEventSaveDraft(null);
  }

  function dismissEventDeleteDialog() {
    setEventDialog(null);
    setPendingEventDeleteDraft(null);
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerLeft: () => (
            <View className="flex-row items-center gap-1.5 pl-2">
              <Pressable
                accessibilityLabel="Select visible calendars"
                className="rounded-lg px-3 py-1.5 active:opacity-70"
                onPress={() => setIsPickerOpen(true)}
              >
                <Icon as={Eye} size={18} />
              </Pressable>
              {[1, 2, 3].map((n) => (
                <Pressable
                  accessibilityLabel={`Show ${n} day${n > 1 ? "s" : ""}`}
                  className={`h-8 min-w-8 items-center justify-center rounded-full px-2.5 active:opacity-70 ${
                    visibleDaysCount === n ? "bg-foreground/15" : ""
                  }`}
                  key={n}
                  onPress={() => setVisibleDaysCount(n)}
                >
                  <Text
                    className={
                      visibleDaysCount === n
                        ? "font-sans-medium text-foreground"
                        : "text-foreground"
                    }
                  >
                    {n}d
                  </Text>
                </Pressable>
              ))}
            </View>
          ),
          headerRight: () => (
            <View className="flex-row items-center gap-1.5 pr-2">
              <Pressable
                accessibilityLabel="Go to today"
                className="rounded-lg px-3 py-1.5 active:opacity-70"
                onPress={goToToday}
              >
                <Text className="font-medium text-foreground">Today</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Previous days"
                className="rounded-lg p-1.5 active:opacity-70"
                onPress={goToPrevious}
              >
                <Icon as={ChevronLeft} size={18} />
              </Pressable>
              <Pressable
                accessibilityLabel="Next days"
                className="rounded-lg p-1.5 active:opacity-70"
                onPress={goToNext}
              >
                <Icon as={ChevronRight} size={18} />
              </Pressable>
            </View>
          ),
          title: "Calendar",
        }}
      />

      <GestureDetector gesture={swipeGesture}>
        <View className="flex-1">
          {/* Day headers */}
          <View className="flex-row border-border border-t border-b">
            <View
              className="items-end justify-center border-border border-r pr-2"
              style={{ width: TIME_GUTTER_WIDTH_PX }}
            >
              <Text
                adjustsFontSizeToFit
                className="text-[11px] text-muted-foreground"
                numberOfLines={1}
              >
                {gutterMonths}
              </Text>
            </View>
            <View className="flex-1 flex-row">
              {visibleDays.map((day) => {
                const isTodayHighlight = isToday(day, timeZone);
                const { weekday, dayNumber } = formatDayHeader(day);

                const whoop = whoopSummaries.get(day.toString());

                return (
                  <View
                    accessibilityActions={[
                      { label: "New event or task", name: "activate" },
                    ]}
                    accessibilityHint="Creates an event or task on this day"
                    accessibilityLabel={dayHeaderLabel(
                      day,
                      whoop,
                      isTodayHighlight
                    )}
                    accessibilityRole="button"
                    accessible
                    className={`flex-1 items-center justify-center gap-0.5 border-border border-r py-2 ${isTodayHighlight ? "bg-foreground/[0.03]" : ""}`}
                    key={day.toString()}
                    // Fabric sends a VoiceOver double-tap to
                    // onAccessibilityTap; the named action covers the
                    // actions rotor.
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === "activate") {
                        openCreateChooserForDay(day);
                      }
                    }}
                    onAccessibilityTap={() => openCreateChooserForDay(day)}
                  >
                    <View className="flex-row items-center gap-1.5">
                      <Text
                        className={`text-sm ${isTodayHighlight ? "font-sans-medium text-foreground" : "text-muted-foreground"}`}
                      >
                        {weekday}
                      </Text>
                      <View
                        className={`h-6 min-w-6 items-center justify-center rounded-full px-1 ${isTodayHighlight ? "bg-primary" : ""}`}
                      >
                        <Text
                          className={`font-sans-medium text-sm ${isTodayHighlight ? "text-primary-foreground" : "text-foreground"}`}
                        >
                          {dayNumber}
                        </Text>
                      </View>
                    </View>
                    {showWhoopRow ? <WhoopDayStats summary={whoop} /> : null}
                  </View>
                );
              })}
            </View>
          </View>

          {/* All-day events row; it always shows, so paging doesn't move the grid. */}
          <View className="flex-row border-border border-b">
            <View
              className="items-end border-border border-r pt-1.5 pr-2"
              style={{ width: TIME_GUTTER_WIDTH_PX }}
            >
              <Text className="text-[10px] text-muted-foreground">All day</Text>
            </View>
            <View className="flex-1 flex-row">
              {visibleDays.map((day) => {
                const items = allDayEventsByDay.get(day.toString()) ?? [];
                return (
                  <View
                    className="min-h-7 flex-1 gap-1 border-border border-r px-1 py-1"
                    key={`${day.toString()}-allday`}
                  >
                    <AllDayCellItems
                      items={items}
                      onMore={() => {
                        setPendingAllDayEdit(null);
                        setAllDayListDay(day);
                      }}
                      onOpen={openEditAllDayEvent}
                    />
                  </View>
                );
              })}
            </View>
          </View>

          {/* Scrollable time grid */}
          <ScrollView
            className="flex-1"
            onScroll={handleScroll}
            ref={scrollRef}
            refreshControl={
              <RefreshControl
                onRefresh={refreshCalendarData}
                refreshing={isPullRefreshing}
                tintColor={isDarkColorScheme ? "#fafafa" : "#0a0a0a"}
              />
            }
            scrollEventThrottle={16}
            // iOS scrolls to the top on taps in the navigation bar, which
            // here would jump the day to midnight whenever a header control
            // is used.
            scrollsToTop={false}
          >
            <View className="flex-row">
              {/* Time gutter */}
              <View
                className="border-border border-r"
                style={{ width: TIME_GUTTER_WIDTH_PX }}
              >
                {HOURS.map((hour) => (
                  <View
                    className="justify-center pr-1"
                    key={`gutter-${hour}`}
                    style={{ height: PIXELS_PER_HOUR }}
                  >
                    {hour === 0 ? null : (
                      <Text
                        className="text-right text-[10px] text-muted-foreground"
                        style={{
                          transform: [
                            { translateY: -TIME_GUTTER_LABEL_OFFSET_PX },
                          ],
                        }}
                      >
                        {formatHourLabel(hour)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>

              {/* Day columns */}
              <View className="flex-1 flex-row">
                {visibleDays.map((day) => {
                  const dayKey = day.toString();
                  const dayEvents = timedEventsByDay.get(dayKey) ?? [];
                  const dayTasks = taskSegmentsByDay.get(dayKey) ?? [];
                  const isTodayColumn = isToday(day, timeZone);
                  const dayLayouts = collisionLayoutsByDay.get(dayKey);

                  return (
                    <Pressable
                      // Not one accessibility element, so VoiceOver reaches
                      // each block's own controls inside the column.
                      accessible={false}
                      className="relative flex-1 border-border border-r"
                      key={dayKey}
                      onPress={(e) => {
                        const y = e.nativeEvent.locationY;
                        const minutes = (y / PIXELS_PER_HOUR) * 60;
                        openCreateChooserAt(day, minutes);
                      }}
                      style={{ height: totalHeight }}
                    >
                      {/* Hour lines */}
                      {HOURS.map((hour) => (
                        <View
                          className="absolute right-0 left-0 border-border border-t"
                          key={`${dayKey}-line-${hour}`}
                          style={{ top: hour * PIXELS_PER_HOUR }}
                        />
                      ))}

                      {isTodayColumn ? (
                        <CurrentTimeIndicator part="line" timeZone={timeZone} />
                      ) : null}

                      {/* Blocks stop short of the right edge, so a slot
                          is always free to tap for a new event. */}
                      <View
                        pointerEvents="box-none"
                        style={{
                          bottom: 0,
                          left: 0,
                          position: "absolute",
                          right: createGutterPt(visibleDays.length),
                          top: 0,
                        }}
                      >
                        {/* Google events */}
                        {dayEvents.map((evt) => {
                          const eventId = `${evt.source.accountId}-${evt.source.calendarId}-${evt.source.event.id}`;
                          const layout = dayLayouts?.get(eventId);
                          const startMinutes = minutesFromMidnight(
                            evt.segmentStart
                          );
                          const durationMinutes = Math.max(
                            MINUTES_STEP,
                            Math.round(
                              evt.segmentEnd
                                .since(evt.segmentStart)
                                .total({ unit: "minutes" })
                            )
                          );
                          const top = (startMinutes / 60) * PIXELS_PER_HOUR;
                          const adjustedTop = top + EVENT_BLOCK_INSET_PX / 2;
                          const adjustedHeight = blockHeight(durationMinutes);

                          return (
                            <TimedGoogleEventBlock
                              areaWidth={blockAreaWidth}
                              columnIndex={layout?.columnIndex}
                              columnSpan={layout?.columnSpan}
                              height={adjustedHeight}
                              item={evt}
                              key={`${eventId}-${evt.segmentStart.toString()}`}
                              onLongPressAt={(offsetY) =>
                                showBlockMenu({
                                  day,
                                  offsetY,
                                  onOpen: () => openEditTimedEvent(evt),
                                  title:
                                    evt.source.event.summary || "(No title)",
                                })
                              }
                              onPress={() => openEditTimedEvent(evt)}
                              stackDepth={layout?.stackDepth}
                              top={adjustedTop}
                              totalColumns={layout?.totalColumns}
                              uncoveredMinutes={layout?.uncoveredMinutes}
                              zIndex={layout?.zIndex}
                            />
                          );
                        })}

                        {/* WHOOP workouts */}
                        {(workoutsByDay.get(dayKey) ?? []).map((workout) => {
                          const layout = dayLayouts?.get(`whoop-${workout.id}`);
                          const minutes = Math.round(
                            workout.segmentEnd
                              .since(workout.segmentStart)
                              .total({ unit: "minutes" })
                          );
                          return (
                            <EventBlock
                              areaWidth={blockAreaWidth}
                              color={
                                isDarkColorScheme
                                  ? WORKOUT_COLOR.dark
                                  : WORKOUT_COLOR.light
                              }
                              columnIndex={layout?.columnIndex}
                              columnSpan={layout?.columnSpan}
                              details={
                                workout.strainScore === null
                                  ? []
                                  : [
                                      {
                                        icon: Activity,
                                        label: `Strain ${workout.strainScore.toFixed(1)}`,
                                        short: workout.strainScore.toFixed(1),
                                      },
                                    ]
                              }
                              end={workout.end}
                              height={blockHeight(minutes)}
                              key={workout.id}
                              minutes={minutes}
                              onLongPressAt={(offsetY) =>
                                showBlockMenu({
                                  day,
                                  offsetY,
                                  onOpen: () => setOpenWorkout(workout),
                                  title: workout.sportName || "Workout",
                                })
                              }
                              onPress={() => setOpenWorkout(workout)}
                              stackDepth={layout?.stackDepth}
                              start={workout.start}
                              title={workout.sportName || "Workout"}
                              top={
                                (minutesFromMidnight(workout.segmentStart) /
                                  60) *
                                  PIXELS_PER_HOUR +
                                EVENT_BLOCK_INSET_PX / 2
                              }
                              totalColumns={layout?.totalColumns}
                              uncoveredMinutes={layout?.uncoveredMinutes}
                              zIndex={layout?.zIndex}
                            />
                          );
                        })}

                        {/* Scheduled tasks */}
                        {dayTasks.map((segment) => {
                          const { end, start, task } = segment;
                          const layout = dayLayouts?.get(task.id);
                          const durationMinutes = Math.round(
                            segment.segmentEnd
                              .since(segment.segmentStart)
                              .total({ unit: "minutes" })
                          );
                          const top =
                            (minutesFromMidnight(segment.segmentStart) / 60) *
                            PIXELS_PER_HOUR;
                          const adjustedTop = top + EVENT_BLOCK_INSET_PX / 2;
                          const adjustedHeight = blockHeight(durationMinutes);

                          return (
                            <TaskBlock
                              areaWidth={blockAreaWidth}
                              columnIndex={layout?.columnIndex}
                              columnSpan={layout?.columnSpan}
                              details={taskTagDetails(task)}
                              done={task.status === "done"}
                              end={end}
                              height={adjustedHeight}
                              key={`${task.id}-${segment.segmentStart.toString()}`}
                              minutes={durationMinutes}
                              onLongPressAt={(offsetY) =>
                                showBlockMenu({
                                  day,
                                  done: task.status === "done",
                                  offsetY,
                                  onOpen: () => taskFlow.openEdit(task),
                                  onToggleDone: () => toggleTaskDone(task),
                                  title: task.title,
                                })
                              }
                              onPress={() => taskFlow.openEdit(task)}
                              onToggleDone={() => toggleTaskDone(task)}
                              stackDepth={layout?.stackDepth}
                              start={start}
                              title={task.title}
                              top={adjustedTop}
                              totalColumns={layout?.totalColumns}
                              uncoveredMinutes={layout?.uncoveredMinutes}
                              zIndex={layout?.zIndex}
                            />
                          );
                        })}
                      </View>

                      {isTodayColumn ? (
                        <CurrentTimeIndicator part="dot" timeZone={timeZone} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </GestureDetector>

      <CalendarPickerModal
        onClose={() => setIsPickerOpen(false)}
        open={isPickerOpen}
      />

      {eventDraft ? (
        <EventEditorSheet
          calendarOptions={eventCalendarOptions}
          draft={eventDraft}
          isSaving={isSavingEvent || isDeletingEvent}
          masterLoading={recurringMasterEvent.isLoading}
          masterRecurrence={masterRecurrence}
          onClose={closeEventModal}
          onDelete={requestDeleteEvent}
          onSubmit={(draft) => {
            // The sheet holds ("Saving…") until the save ends; a failure
            // leaves it open with the draft.
            // Typing after this point wouldn't be saved: close the keyboard.
            Keyboard.dismiss();
            setIsSavingEvent(true);
            saveEvent(draft)
              .catch(() => null)
              .finally(() => setIsSavingEvent(false));
          }}
          overlay={
            <>
              <EventDeleteDialogs
                dialog={eventDialog}
                onCancel={dismissEventDeleteDialog}
                onConfirm={(scope) => {
                  confirmEventDelete(scope).catch(() => null);
                }}
                onScopeChange={setEventDeleteScope}
                pending={isDeletingEvent}
                scope={eventDeleteScope}
              />
              <EventSaveScopeDialog
                changes={
                  pendingEventSaveDraft
                    ? eventSaveChanges(pendingEventSaveDraft)
                    : null
                }
                isVisible={eventDialog === "save"}
                onCancel={dismissEventSaveDialog}
                onConfirm={() => {
                  confirmScopedEventSave().catch(() => null);
                }}
                onScopeChange={setEventSaveScope}
                pending={isSavingEvent}
                scope={eventSaveScope}
              />
            </>
          }
        />
      ) : null}

      <AllDayListSheet
        day={allDayListDay}
        itemsByDay={allDayEventsByDay}
        onClose={() => setAllDayListDay(null)}
        onDismissed={() => {
          // Open the chosen event only once the list's modal is gone; a modal
          // presented while another dismisses is swallowed on iOS.
          if (pendingAllDayEdit) {
            openEditAllDayEvent(pendingAllDayEdit);
            setPendingAllDayEdit(null);
          }
        }}
        onOpen={(e) => {
          setPendingAllDayEdit(e);
          setAllDayListDay(null);
        }}
      />

      <WorkoutSheet
        onClose={() => setOpenWorkout(null)}
        workout={openWorkout}
      />

      <BottomSheet
        isVisible={createSlotSelection !== null}
        onClose={closeCreateChooser}
        onDismissed={runPendingCreateAction}
        snapPoints={[0.34, 0.42]}
        title="Create"
      >
        <Text className="mb-3 text-muted-foreground text-sm">
          {createChooserCopy(shownCreateSlot, timeZone)}
        </Text>
        <View className="gap-3">
          <Button
            disabled={!defaultCalendar}
            onPress={() => {
              if (!createSlotSelection) {
                return;
              }
              setPendingCreateAction({
                day: createSlotSelection.day,
                kind: "event",
                minutes: createSlotSelection.minutes,
              });
              closeCreateChooser();
            }}
            variant="outline"
          >
            New event
          </Button>
          <Button
            onPress={() => {
              if (!createSlotSelection) {
                return;
              }
              setPendingCreateAction({
                day: createSlotSelection.day,
                kind: "task",
                minutes: createSlotSelection.minutes,
              });
              closeCreateChooser();
            }}
            variant="outline"
          >
            New task
          </Button>
          {defaultCalendar ? null : (
            <Text className="text-muted-foreground text-xs">
              {eventCreationBlockedReason({
                hasGoogleAccount: googleAccounts.length > 0,
                loading: isLoadingCalendars,
              })}
            </Text>
          )}
        </View>
      </BottomSheet>

      <TaskEditorSheet
        // Drop the content as soon as it closes rather than animating it out.
        draft={taskFlow.isEditorOpen ? taskFlow.draft : null}
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
    </View>
  );
}
