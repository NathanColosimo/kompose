import type {
  DeleteScope,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import {
  currentDateAtom,
  eventWindowAtom,
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
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import {
  type CalendarIdentifier,
  isCalendarVisible,
  type VisibleCalendars,
  visibleCalendarsAtom,
} from "@kompose/state/atoms/visible-calendars";
import {
  calculateCollisionLayout,
  type ItemLayout,
  type PositionedItem,
} from "@kompose/state/collision-utils";
import {
  GOOGLE_ACCOUNTS_QUERY_KEY,
  GOOGLE_CALENDARS_QUERY_KEY,
  getGoogleEventsQueryKey,
} from "@kompose/state/google-calendar-query-keys";
import {
  getDefaultRecurrenceScopeForEvent,
  isRecurringGoogleEvent,
} from "@kompose/state/google-event-recurrence";
import { useEnsureVisibleCalendars } from "@kompose/state/hooks/use-ensure-visible-calendars";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useMoveGoogleEventMutation } from "@kompose/state/hooks/use-move-google-event-mutation";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  RECURRENCE_SCOPE_OPTIONS,
  TASK_DELETE_SCOPE_OPTIONS,
  TASK_UPDATE_SCOPE_OPTIONS,
} from "@kompose/state/recurrence-scope-options";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
  resolveTaskRecurrenceForEditor,
} from "@kompose/state/task-recurrence";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router/stack";
import { useAtom, useAtomValue } from "jotai";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Temporal } from "temporal-polyfill";
import type {
  CalendarOption,
  CreateEventDraft,
  EditEventDraft,
  EventDraft,
} from "@/components/calendar/calendar-editor-types";
import { isEditEventDraft } from "@/components/calendar/calendar-editor-types";
import {
  CreateEventEditorSheet,
  EditEventEditorSheet,
} from "@/components/calendar/calendar-event-editor-sheet";
import { CalendarPickerModal } from "@/components/calendar/calendar-picker-modal";
import {
  type TaskDraft,
  TaskEditorSheet,
} from "@/components/tasks/task-editor-sheet";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Icon } from "@/components/ui/icon";
import { RadioGroup } from "@/components/ui/radio";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/color-scheme-context";

const PIXELS_PER_HOUR = 60;
const MINUTES_STEP = 15;
const DEFAULT_SCROLL_HOUR = 8;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
// Swipe thresholds for horizontal navigation without interfering with vertical scroll.
const SWIPE_ACTIVATION_DISTANCE = 16;
const SWIPE_TRIGGER_DISTANCE = 60;
const SWIPE_VERTICAL_TOLERANCE = 12;
const EVENT_BLOCK_INSET_PX = 1;
const EVENT_OUTLINE_WIDTH_PX = 1;
const EVENT_OUTLINE_COLOR = "rgba(0,0,0,0.35)";
const TIME_GUTTER_WIDTH_PX = 56;
const TIME_GUTTER_LABEL_OFFSET_PX = PIXELS_PER_HOUR / 2;

// --- Temporal helpers ---

function todayPlainDate(timeZone: string): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

function combineDateTime(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string
): Temporal.ZonedDateTime {
  return date.toZonedDateTime({ timeZone, plainTime: time });
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
  return { weekday, dayNumber: date.day };
}

function calculateTimePosition(timeZone: string): number {
  const now = Temporal.Now.zonedDateTimeISO(timeZone);
  return (now.hour + now.minute / 60) * PIXELS_PER_HOUR;
}

function CurrentTimeIndicator({ timeZone }: { timeZone: string }) {
  const [topPosition, setTopPosition] = useState(() =>
    calculateTimePosition(timeZone)
  );

  useEffect(() => {
    // Update position immediately, then every minute.
    setTopPosition(calculateTimePosition(timeZone));
    const interval = setInterval(() => {
      setTopPosition(calculateTimePosition(timeZone));
    }, 60_000);
    return () => clearInterval(interval);
  }, [timeZone]);

  return (
    <View
      className="pointer-events-none absolute right-0 left-0 z-20 flex-row items-center"
      style={{ top: topPosition, transform: [{ translateY: -4 }] }}
    >
      <View className="size-2 rounded-full bg-red-500" />
      <View className="h-0.5 flex-1 bg-red-500" />
    </View>
  );
}

function formatTimeShort(zdt: Temporal.ZonedDateTime): string {
  const hour = zdt.hour;
  const minute = zdt.minute;
  const ampm = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;
  return minute === 0
    ? `${displayHour}${ampm}`
    : `${displayHour}:${minute.toString().padStart(2, "0")}${ampm}`;
}

function formatHourLabel(hour: number): string {
  const time = new Temporal.PlainTime(hour, 0);
  return time.toLocaleString(undefined, { hour: "numeric" });
}

function snapMinutes(mins: number): number {
  const snapped = Math.round(mins / MINUTES_STEP) * MINUTES_STEP;
  return Math.max(0, Math.min(24 * 60 - MINUTES_STEP, snapped));
}

function isoStringToZonedDateTime(str: string, timeZone: string) {
  const instant = Temporal.Instant.from(str);
  return instant.toZonedDateTimeISO(timeZone);
}

function calendarLookupKey(accountId: string, calendarId: string): string {
  return `${accountId}:${calendarId}`;
}

interface PositionedGoogleEvent {
  end: Temporal.ZonedDateTime;
  source: {
    accountId: string;
    calendarId: string;
    event: GoogleEvent;
    calendarColorId: string | null;
    calendarBackgroundColor: string | null;
    calendarForegroundColor: string | null;
  };
  start: Temporal.ZonedDateTime;
}

interface AllDayGoogleEvent {
  date: Temporal.PlainDate;
  source: {
    accountId: string;
    calendarId: string;
    event: GoogleEvent;
    calendarColorId: string | null;
    calendarBackgroundColor: string | null;
    calendarForegroundColor: string | null;
  };
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

function AllDayEventChip({
  item,
  onPress,
}: {
  item: AllDayGoogleEvent;
  onPress: () => void;
}) {
  const palette = useAtomValue(
    normalizedGoogleColorsAtomFamily(item.source.accountId)
  );
  const calendarPaletteColor =
    item.source.calendarColorId && palette?.calendar
      ? palette.calendar[item.source.calendarColorId]
      : undefined;
  const { background, foreground } = resolveGoogleEventColors({
    colorId: item.source.event.colorId,
    palette: palette?.event,
    calendarBackgroundColor:
      item.source.calendarBackgroundColor ?? calendarPaletteColor?.background,
    calendarForegroundColor:
      item.source.calendarForegroundColor ?? calendarPaletteColor?.foreground,
  });

  return (
    <Pressable
      className="rounded-md px-1.5 py-1"
      onPress={onPress}
      style={{
        backgroundColor: background,
        borderColor: EVENT_OUTLINE_COLOR,
        borderRadius: 6,
        borderWidth: EVENT_OUTLINE_WIDTH_PX,
      }}
    >
      <Text
        className="text-[11px]"
        numberOfLines={1}
        style={{ color: foreground }}
      >
        {item.source.event.summary ?? "All-day"}
      </Text>
    </Pressable>
  );
}

function TimedGoogleEventBlock({
  item,
  top,
  height,
  durationMinutes,
  columnIndex = 0,
  totalColumns = 1,
  columnSpan = 1,
  zIndex = 1,
  onPress,
}: {
  item: PositionedGoogleEvent;
  top: number;
  height: number;
  durationMinutes: number;
  columnIndex?: number;
  totalColumns?: number;
  columnSpan?: number;
  zIndex?: number;
  onPress: () => void;
}) {
  const palette = useAtomValue(
    normalizedGoogleColorsAtomFamily(item.source.accountId)
  );
  const calendarPaletteColor =
    item.source.calendarColorId && palette?.calendar
      ? palette.calendar[item.source.calendarColorId]
      : undefined;
  const { background, foreground } = resolveGoogleEventColors({
    colorId: item.source.event.colorId,
    palette: palette?.event,
    calendarBackgroundColor:
      item.source.calendarBackgroundColor ?? calendarPaletteColor?.background,
    calendarForegroundColor:
      item.source.calendarForegroundColor ?? calendarPaletteColor?.foreground,
  });

  // Calculate horizontal positioning based on collision layout.
  // columnSpan lets items expand into adjacent empty columns.
  const singleColumnWidth = 100 / totalColumns;
  const columnWidthPercent = singleColumnWidth * columnSpan;
  const leftPercent = columnIndex * singleColumnWidth;

  return (
    <Pressable
      className="absolute rounded-md px-1 py-1 shadow-black/5 shadow-sm"
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={{
        top,
        height,
        left: `${leftPercent}%`,
        width: `${columnWidthPercent}%`,
        zIndex,
        backgroundColor: background,
        borderColor: EVENT_OUTLINE_COLOR,
        borderRadius: 6,
        borderWidth: EVENT_OUTLINE_WIDTH_PX,
      }}
    >
      <Text
        className="font-semibold text-[10px]"
        numberOfLines={1}
        style={{ color: foreground }}
      >
        {item.source.event.summary ?? "Event"}
      </Text>
      {/* Show time for events 30 minutes or longer */}
      {durationMinutes >= 30 ? (
        <Text
          className="text-[9px] opacity-80"
          numberOfLines={1}
          style={{ color: foreground }}
        >
          {formatTimeShort(item.start)} - {formatTimeShort(item.end)}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function CalendarTab() {
  const { isDarkColorScheme } = useColorScheme();
  const queryClient = useQueryClient();
  const { createEvent, updateEvent, deleteEvent } = useGoogleEventMutations();
  const moveEvent = useMoveGoogleEventMutation();

  // Shared atoms for calendar state (mobile variants clamp to 1-3 days).
  const timeZone = useAtomValue(timezoneAtom);
  const [, setCurrentDate] = useAtom(currentDateAtom);
  const [visibleDaysCount, setVisibleDaysCount] = useAtom(
    mobileVisibleDaysCountAtom
  );
  const visibleDays = useAtomValue(mobileVisibleDaysAtom);
  const window = useAtomValue(eventWindowAtom);

  // Tasks: use the same query source as mutations to avoid stale editor state.
  const { tasksQuery, updateTask, deleteTask } = useTasks();
  const tasks = tasksQuery.data ?? [];

  const scheduledTasks = useMemo(
    () => tasks.filter((t) => t.startDate !== null && t.startTime !== null),
    [tasks]
  );

  // Google accounts/calendars/events.
  const googleAccounts = useAtomValue(googleAccountsDataAtom);

  const googleCalendars = useAtomValue(googleCalendarsDataAtom);
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
        colorId: entry.calendar.colorId ?? null,
        backgroundColor: entry.calendar.backgroundColor ?? null,
        foregroundColor: entry.calendar.foregroundColor ?? null,
      });
    }

    return metadata;
  }, [googleCalendars]);

  const [visibleCalendars, setVisibleCalendars] = useAtom(visibleCalendarsAtom);
  const effectiveVisibleCalendars: VisibleCalendars = visibleCalendars ?? null;

  const allCalendarIds = useMemo<CalendarIdentifier[]>(
    () =>
      googleCalendars.map((calendar) => ({
        accountId: calendar.accountId,
        calendarId: calendar.calendar.id,
      })),
    [googleCalendars]
  );

  // Check data readiness before sanitising the visible calendars selection.
  const isFetchingAccounts = useIsFetching({
    queryKey: GOOGLE_ACCOUNTS_QUERY_KEY,
  });
  const isFetchingCalendars = useIsFetching({
    queryKey: GOOGLE_CALENDARS_QUERY_KEY,
  });
  const dataReady = isFetchingAccounts === 0 && isFetchingCalendars === 0;

  useEnsureVisibleCalendars(allCalendarIds, dataReady);

  const visibleCalendarIds = useAtomValue(resolvedVisibleCalendarIdsAtom);

  const { events: googleEvents, isFetching: isFetchingGoogleEvents } =
    useGoogleEvents({
      visibleCalendars: visibleCalendarIds,
      window,
    });

  // Calendar picker modal.
  const [isPickerOpen, setIsPickerOpen] = useState(false);

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
        calendarId: item.calendarId,
        event: item.event,
        calendarColorId: calendarMetadata?.colorId ?? null,
        calendarBackgroundColor: calendarMetadata?.backgroundColor ?? null,
        calendarForegroundColor: calendarMetadata?.foregroundColor ?? null,
      };
      const startDate = item.event.start.date;
      const startDateTime = item.event.start.dateTime;
      const endDateTime = item.event.end.dateTime;

      if (startDate && !startDateTime && !endDateTime) {
        const date = Temporal.PlainDate.from(startDate);
        const bucket = allDay.get(date.toString());
        if (bucket) {
          bucket.push({ source, date });
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
        const dayKey = start.toPlainDate().toString();
        const bucket = timed.get(dayKey);
        if (bucket) {
          bucket.push({ source, start, end });
        }
      } catch {
        // Skip unparseable events.
      }
    }

    return { timedEventsByDay: timed, allDayEventsByDay: allDay };
  }, [calendarMetadataByKey, googleEvents, timeZone, visibleDays]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskSelectDecoded[]>();
    for (const day of visibleDays) {
      map.set(day.toString(), []);
    }
    for (const task of scheduledTasks) {
      if (!task.startDate) {
        continue;
      }
      const bucket = map.get(task.startDate.toString());
      if (bucket) {
        bucket.push(task);
      }
    }
    return map;
  }, [scheduledTasks, visibleDays]);

  const hasAllDayEvents = useMemo(
    () => Array.from(allDayEventsByDay.values()).some((v) => v.length > 0),
    [allDayEventsByDay]
  );

  // Calculate collision layouts for all visible days (tasks + google events combined).
  const collisionLayoutsByDay = useMemo(() => {
    const layoutsByDay = new Map<string, Map<string, ItemLayout>>();

    for (const day of visibleDays) {
      const dayKey = day.toString();
      const dayTasks = tasksByDay.get(dayKey) ?? [];
      const dayGoogleEvents = timedEventsByDay.get(dayKey) ?? [];

      // Convert tasks to PositionedItems.
      const taskItems: PositionedItem[] = dayTasks
        .filter((task) => task.startDate !== null && task.startTime !== null)
        .map((task) => {
          const start = task.startDate?.toZonedDateTime({
            timeZone,
            plainTime:
              task.startTime ??
              Temporal.PlainTime.from({ hour: 0, minute: 0, second: 0 }),
          });
          const startMinutes = start ? minutesFromMidnight(start) : 0;
          const endMinutes = startMinutes + (task.durationMinutes || 30);
          return {
            id: task.id,
            type: "task" as const,
            startMinutes,
            endMinutes,
          };
        });

      // Convert google events to PositionedItems.
      const googleItems: PositionedItem[] = dayGoogleEvents.map((ge) => {
        const startMinutes = minutesFromMidnight(ge.start);
        const endMinutes = minutesFromMidnight(ge.end);
        return {
          id: `${ge.source.accountId}-${ge.source.calendarId}-${ge.source.event.id}`,
          type: "google-event" as const,
          startMinutes,
          endMinutes,
        };
      });

      const allItems = [...taskItems, ...googleItems];
      const layout = calculateCollisionLayout(allItems);
      layoutsByDay.set(dayKey, layout);
    }

    return layoutsByDay;
  }, [visibleDays, tasksByDay, timedEventsByDay, timeZone]);

  // Create/Edit event modal state.
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const editingEventDraft =
    eventDraft && isEditEventDraft(eventDraft) ? eventDraft : null;
  const recurringMasterEvent = useRecurringEventMaster({
    accountId: editingEventDraft?.sourceCalendar.accountId ?? "",
    calendarId: editingEventDraft?.sourceCalendar.calendarId ?? "",
    event: editingEventDraft?.sourceEvent ?? null,
    enabled: Boolean(editingEventDraft),
  });
  const masterRecurrence = recurringMasterEvent.data?.recurrence ?? [];
  const [eventSaveScope, setEventSaveScope] = useState<RecurrenceScope>("this");
  const [isEventSaveScopeDialogVisible, setIsEventSaveScopeDialogVisible] =
    useState(false);
  const [eventDeleteScope, setEventDeleteScope] =
    useState<RecurrenceScope>("this");
  const [isEventDeleteScopeDialogVisible, setIsEventDeleteScopeDialogVisible] =
    useState(false);
  const [
    isSimpleEventDeleteDialogVisible,
    setIsSimpleEventDeleteDialogVisible,
  ] = useState(false);
  const [pendingEventSaveDraft, setPendingEventSaveDraft] =
    useState<EditEventDraft | null>(null);
  const [pendingEventDeleteDraft, setPendingEventDeleteDraft] =
    useState<EditEventDraft | null>(null);

  const openEventDialog = useCallback(
    (dialog: "save" | "delete" | "simple-delete") => {
      setIsEventSaveScopeDialogVisible(dialog === "save");
      setIsEventDeleteScopeDialogVisible(dialog === "delete");
      setIsSimpleEventDeleteDialogVisible(dialog === "simple-delete");
    },
    []
  );

  useEffect(() => {
    if (
      !(
        editingEventDraft &&
        editingEventDraft.recurrence.length === 0 &&
        masterRecurrence.length > 0
      )
    ) {
      return;
    }

    setEventDraft((current) =>
      current &&
      isEditEventDraft(current) &&
      current.eventId === editingEventDraft.eventId
        ? { ...current, recurrence: masterRecurrence }
        : current
    );
  }, [editingEventDraft, masterRecurrence]);

  // Edit scheduled task modal state.
  const [editingTask, setEditingTask] = useState<TaskSelectDecoded | null>(
    null
  );
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [pendingTaskSaveDraft, setPendingTaskSaveDraft] =
    useState<TaskDraft | null>(null);
  const [taskSaveScope, setTaskSaveScope] = useState<UpdateScope>("this");
  const [isTaskSaveScopeDialogVisible, setIsTaskSaveScopeDialogVisible] =
    useState(false);
  const [taskDeleteScope, setTaskDeleteScope] = useState<DeleteScope>("this");
  const [isTaskDeleteScopeDialogVisible, setIsTaskDeleteScopeDialogVisible] =
    useState(false);

  const allCalendarOptions = useMemo<CalendarOption[]>(
    () =>
      googleCalendars.map((calendar) => ({
        accountId: calendar.accountId,
        calendarId: calendar.calendar.id,
        color:
          calendarMetadataByKey.get(
            calendarLookupKey(calendar.accountId, calendar.calendar.id)
          )?.backgroundColor ?? null,
        label: calendar.calendar.summary ?? "Calendar",
      })),
    [calendarMetadataByKey, googleCalendars]
  );
  const visibleCalendarOptions = useMemo<CalendarOption[]>(() => {
    const visible = googleCalendars.filter((c) =>
      isCalendarVisible(effectiveVisibleCalendars, c.accountId, c.calendar.id)
    );
    return visible.map((c) => ({
      accountId: c.accountId,
      calendarId: c.calendar.id,
      color:
        calendarMetadataByKey.get(calendarLookupKey(c.accountId, c.calendar.id))
          ?.backgroundColor ?? null,
      label: c.calendar.summary ?? "Calendar",
    }));
  }, [calendarMetadataByKey, effectiveVisibleCalendars, googleCalendars]);

  const defaultCalendar = visibleCalendarOptions[0] ?? allCalendarOptions[0];
  const editCalendarOptions = useMemo(() => {
    if (!editingEventDraft) {
      return [];
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
      const snapped = snapMinutes(minutes);
      const startTime = Temporal.PlainTime.from({
        hour: Math.floor(snapped / 60),
        minute: snapped % 60,
        second: 0,
      });
      const endTime = startTime.add({ minutes: 30 });
      const createDraft: CreateEventDraft = {
        mode: "create",
        summary: "",
        description: "",
        location: "",
        colorId: null,
        calendar: {
          accountId: defaultCalendar.accountId,
          calendarId: defaultCalendar.calendarId,
        },
        allDay: false,
        startDate: day,
        endDate: day,
        startTime,
        endTime,
        recurrence: [],
        conferenceData: null,
      };
      setIsEventSaveScopeDialogVisible(false);
      setIsEventDeleteScopeDialogVisible(false);
      setIsSimpleEventDeleteDialogVisible(false);
      setPendingEventSaveDraft(null);
      setPendingEventDeleteDraft(null);
      setEventDraft(createDraft);
    },
    [defaultCalendar]
  );

  const openEditTimedEvent = useCallback((item: PositionedGoogleEvent) => {
    const editDraft: EditEventDraft = {
      mode: "edit",
      eventId: item.source.event.id,
      summary: item.source.event.summary ?? "",
      description: item.source.event.description ?? "",
      location: item.source.event.location ?? "",
      colorId: item.source.event.colorId ?? null,
      calendar: {
        accountId: item.source.accountId,
        calendarId: item.source.calendarId,
      },
      sourceCalendar: {
        accountId: item.source.accountId,
        calendarId: item.source.calendarId,
      },
      allDay: false,
      startDate: item.start.toPlainDate(),
      endDate: item.end.toPlainDate(),
      startTime: item.start.toPlainTime(),
      endTime: item.end.toPlainTime(),
      recurrence: item.source.event.recurrence ?? [],
      conferenceData: item.source.event.conferenceData ?? null,
      sourceEvent: item.source.event,
    };
    setIsEventSaveScopeDialogVisible(false);
    setIsEventDeleteScopeDialogVisible(false);
    setIsSimpleEventDeleteDialogVisible(false);
    setPendingEventSaveDraft(null);
    setPendingEventDeleteDraft(null);
    setEventDraft(editDraft);
  }, []);

  const openEditAllDayEvent = useCallback((item: AllDayGoogleEvent) => {
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
      mode: "edit",
      eventId: item.source.event.id,
      summary: item.source.event.summary ?? "",
      description: item.source.event.description ?? "",
      location: item.source.event.location ?? "",
      colorId: item.source.event.colorId ?? null,
      calendar: {
        accountId: item.source.accountId,
        calendarId: item.source.calendarId,
      },
      sourceCalendar: {
        accountId: item.source.accountId,
        calendarId: item.source.calendarId,
      },
      allDay: true,
      startDate,
      endDate,
      startTime: null,
      endTime: null,
      recurrence: item.source.event.recurrence ?? [],
      conferenceData: item.source.event.conferenceData ?? null,
      sourceEvent: item.source.event,
    };
    setIsEventSaveScopeDialogVisible(false);
    setIsEventDeleteScopeDialogVisible(false);
    setIsSimpleEventDeleteDialogVisible(false);
    setPendingEventSaveDraft(null);
    setPendingEventDeleteDraft(null);
    setEventDraft(editDraft);
  }, []);

  const closeEventModal = useCallback(() => {
    setIsEventSaveScopeDialogVisible(false);
    setIsEventDeleteScopeDialogVisible(false);
    setIsSimpleEventDeleteDialogVisible(false);
    setPendingEventSaveDraft(null);
    setPendingEventDeleteDraft(null);
    setEventDraft(null);
  }, []);

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
        startPayload = {
          dateTime: startZdt.toInstant().toString(),
          timeZone,
        };
        endPayload = {
          dateTime: endZdt.toInstant().toString(),
          timeZone,
        };
      }

      return {
        summary: currentDraft.summary.trim(),
        description: currentDraft.description.trim() || undefined,
        location: currentDraft.location.trim() || undefined,
        colorId: currentDraft.colorId ?? undefined,
        conferenceData: currentDraft.conferenceData ?? undefined,
        recurrence:
          currentDraft.recurrence.length > 0
            ? currentDraft.recurrence
            : undefined,
        start: startPayload,
        end: endPayload,
      };
    },
    [timeZone]
  );

  const commitRecurringEventSave = useCallback(
    async (
      draft: EditEventDraft,
      scope: RecurrenceScope,
      closeAfter = true
    ) => {
      const sourceCalendar = draft.sourceCalendar;
      const destinationCalendarId =
        draft.calendar.calendarId !== sourceCalendar.calendarId
          ? draft.calendar.calendarId
          : null;
      const eventPayload = buildEventPayload(draft);
      await updateEvent.mutateAsync({
        accountId: sourceCalendar.accountId,
        calendarId: sourceCalendar.calendarId,
        eventId: draft.eventId,
        recurrenceScope: scope,
        event: {
          ...draft.sourceEvent,
          ...eventPayload,
          start: {
            ...draft.sourceEvent.start,
            ...eventPayload.start,
          },
          end: {
            ...draft.sourceEvent.end,
            ...eventPayload.end,
          },
        },
      });

      if (destinationCalendarId) {
        await moveEvent.mutateAsync({
          accountId: sourceCalendar.accountId,
          calendarId: sourceCalendar.calendarId,
          eventId: draft.eventId,
          destinationCalendarId,
          scope,
        });
      }

      if (closeAfter) {
        closeEventModal();
      }
    },
    [buildEventPayload, closeEventModal, moveEvent, updateEvent]
  );

  const saveEvent = useCallback(
    async (draft: EventDraft) => {
      if (!draft.summary.trim()) {
        return;
      }

      const eventPayload = buildEventPayload(draft);

      if (draft.mode === "create") {
        await createEvent.mutateAsync({
          accountId: draft.calendar.accountId,
          calendarId: draft.calendar.calendarId,
          event: eventPayload,
        });
        closeEventModal();
        return;
      }

      const sourceCalendar = draft.sourceCalendar;
      const destinationCalendarId =
        draft.calendar.calendarId !== sourceCalendar.calendarId
          ? draft.calendar.calendarId
          : null;
      const masterSeriesRecurrence =
        draft.recurrence.length > 0 ? draft.recurrence : masterRecurrence;
      const recurring =
        isRecurringGoogleEvent({
          event: draft.sourceEvent,
          masterRecurrence: masterSeriesRecurrence,
        }) || Boolean(draft.sourceEvent.originalStartTime);

      if (recurring) {
        // Google API doesn't allow moving individual recurring instances,
        // so force scope to "all" when a calendar move is pending.
        const hasCalendarChange =
          draft.calendar.calendarId !== sourceCalendar.calendarId;
        const defaultScope = hasCalendarChange
          ? "all"
          : getDefaultRecurrenceScopeForEvent({
              event: draft.sourceEvent,
              masterRecurrence: masterSeriesRecurrence,
            });
        setPendingEventSaveDraft(draft);
        setEventSaveScope(defaultScope);
        setEventDraft(null);
        openEventDialog("save");
        return;
      }

      await updateEvent.mutateAsync({
        accountId: sourceCalendar.accountId,
        calendarId: sourceCalendar.calendarId,
        eventId: draft.eventId,
        recurrenceScope: "this",
        event: {
          ...draft.sourceEvent,
          ...eventPayload,
          start: {
            ...draft.sourceEvent.start,
            ...eventPayload.start,
          },
          end: {
            ...draft.sourceEvent.end,
            ...eventPayload.end,
          },
        },
      });

      if (destinationCalendarId) {
        await moveEvent.mutateAsync({
          accountId: sourceCalendar.accountId,
          calendarId: sourceCalendar.calendarId,
          eventId: draft.eventId,
          destinationCalendarId,
          scope: "this",
        });
      }

      closeEventModal();
    },
    [
      buildEventPayload,
      closeEventModal,
      createEvent,
      masterRecurrence,
      moveEvent,
      openEventDialog,
      updateEvent,
    ]
  );

  const confirmScopedEventSave = useCallback(async () => {
    if (!pendingEventSaveDraft) {
      return;
    }
    await commitRecurringEventSave(pendingEventSaveDraft, eventSaveScope);
    setPendingEventSaveDraft(null);
    setIsEventSaveScopeDialogVisible(false);
  }, [commitRecurringEventSave, eventSaveScope, pendingEventSaveDraft]);

  const requestDeleteEvent = useCallback(
    (draft: EditEventDraft) => {
      const recurringMasterRecurrence =
        draft.recurrence.length > 0 ? draft.recurrence : masterRecurrence;
      const recurring =
        isRecurringGoogleEvent({
          event: draft.sourceEvent,
          masterRecurrence: recurringMasterRecurrence,
        }) || Boolean(draft.sourceEvent.originalStartTime);

      setPendingEventDeleteDraft(draft);
      setEventDraft(null);

      if (recurring) {
        setEventDeleteScope(
          getDefaultRecurrenceScopeForEvent({
            event: draft.sourceEvent,
            masterRecurrence: recurringMasterRecurrence,
          })
        );
        openEventDialog("delete");
        return;
      }

      openEventDialog("simple-delete");
    },
    [masterRecurrence, openEventDialog]
  );

  const confirmSimpleEventDelete = useCallback(async () => {
    if (!pendingEventDeleteDraft) {
      return;
    }

    await deleteEvent.mutateAsync({
      accountId: pendingEventDeleteDraft.sourceCalendar.accountId,
      calendarId: pendingEventDeleteDraft.sourceCalendar.calendarId,
      eventId: pendingEventDeleteDraft.eventId,
      scope: "this",
    });
    closeEventModal();
  }, [closeEventModal, deleteEvent, pendingEventDeleteDraft]);

  const confirmScopedEventDelete = useCallback(async () => {
    if (!pendingEventDeleteDraft) {
      return;
    }

    await deleteEvent.mutateAsync({
      accountId: pendingEventDeleteDraft.sourceCalendar.accountId,
      calendarId: pendingEventDeleteDraft.sourceCalendar.calendarId,
      eventId: pendingEventDeleteDraft.eventId,
      scope: eventDeleteScope,
    });
    closeEventModal();
  }, [closeEventModal, deleteEvent, eventDeleteScope, pendingEventDeleteDraft]);

  const openEditTask = useCallback(
    (task: TaskSelectDecoded) => {
      const resolvedRecurrence = resolveTaskRecurrenceForEditor(task, tasks);
      const nextEditingTask: TaskSelectDecoded = {
        ...task,
        recurrence: resolvedRecurrence,
      };
      setEditingTask(nextEditingTask);
      setTaskDraft(buildDraftFromTask(nextEditingTask, resolvedRecurrence));
    },
    [tasks]
  );

  const closeTaskModal = useCallback(() => {
    setEditingTask(null);
    setTaskDraft(null);
    setPendingTaskSaveDraft(null);
    setIsTaskSaveScopeDialogVisible(false);
    setIsTaskDeleteScopeDialogVisible(false);
  }, []);

  const commitTaskUpdate = useCallback(
    (nextDraft: TaskDraft, scope: UpdateScope) => {
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
    },
    [editingTask, updateTask]
  );

  const saveTask = useCallback(() => {
    if (!(editingTask && taskDraft)) {
      return;
    }
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
        title: taskDraft.title,
        description: taskDraft.description,
        durationMinutes: taskDraft.durationMinutes,
        dueDate: taskDraft.dueDate,
        startDate: taskDraft.startDate,
        startTime: taskDraft.startTime,
      },
    });

    const decision = getTaskUpdateScopeDecision({
      isRecurring: editingTask.seriesMasterId !== null,
      isSeriesMaster: editingTask.seriesMasterId === editingTask.id,
      hasCoreFieldChanges,
      previousRecurrence: editingTask.recurrence,
      nextRecurrence: taskDraft.recurrence,
      previousTagIds: editingTask.tags.map((tag) => tag.id),
      nextTagIds: taskDraft.tagIds,
    });

    if (decision.action === "prompt") {
      setPendingTaskSaveDraft(taskDraft);
      setTaskSaveScope(decision.defaultScope);
      setTaskDraft(null);
      setIsTaskSaveScopeDialogVisible(true);
      return;
    }

    commitTaskUpdate(taskDraft, decision.scope);
    closeTaskModal();
  }, [closeTaskModal, commitTaskUpdate, editingTask, taskDraft]);

  const confirmScopedTaskSave = useCallback(() => {
    if (!(editingTask && pendingTaskSaveDraft)) {
      return;
    }
    commitTaskUpdate(pendingTaskSaveDraft, taskSaveScope);
    closeTaskModal();
  }, [
    closeTaskModal,
    commitTaskUpdate,
    editingTask,
    pendingTaskSaveDraft,
    taskSaveScope,
  ]);

  const deleteTaskFromCalendar = useCallback(() => {
    if (!editingTask) {
      return;
    }

    if (editingTask.seriesMasterId) {
      setTaskDeleteScope("this");
      setTaskDraft(null);
      setIsTaskDeleteScopeDialogVisible(true);
      return;
    }

    deleteTask.mutate({ id: editingTask.id, scope: "this" });
    closeTaskModal();
  }, [closeTaskModal, deleteTask, editingTask]);

  const confirmScopedTaskDelete = useCallback(() => {
    if (!editingTask) {
      return;
    }

    deleteTask.mutate({ id: editingTask.id, scope: taskDeleteScope });
    closeTaskModal();
  }, [closeTaskModal, deleteTask, editingTask, taskDeleteScope]);

  const toggleTaskStatusFromCalendar = useCallback(
    (nextStatus: TaskDraft["status"]) => {
      if (!editingTask) {
        return;
      }
      updateTask.mutate({
        id: editingTask.id,
        scope: "this",
        task: { status: nextStatus },
      });
      closeTaskModal();
    },
    [closeTaskModal, editingTask, updateTask]
  );

  const totalHeight = 24 * PIXELS_PER_HOUR;
  const scrollRef = useRef<ScrollView>(null);

  // Track scroll position so we can restore it after a pull-to-refresh.
  const scrollOffsetRef = useRef(DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR);
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
      queryKey: GOOGLE_ACCOUNTS_QUERY_KEY,
    });
    queryClient.invalidateQueries({
      queryKey: GOOGLE_CALENDARS_QUERY_KEY,
    });

    // Only refresh visible calendars and the active window to avoid broad invalidation.
    for (const calendar of visibleCalendarIds) {
      queryClient.invalidateQueries({
        queryKey: getGoogleEventsQueryKey(calendar, window),
      });
    }
  }, [queryClient, tasksQuery, visibleCalendarIds, window]);

  const isRefreshing =
    tasksQuery.isFetching ||
    isFetchingGoogleEvents ||
    isFetchingAccounts > 0 ||
    isFetchingCalendars > 0;

  // Clear the pull-to-refresh indicator and restore scroll position once
  // all fetches settle.
  useEffect(() => {
    if (isRefreshingRef.current && !isRefreshing) {
      setIsPullRefreshing(false);
      scrollRef.current?.scrollTo({
        y: scrollOffsetRef.current,
        animated: false,
      });
    }
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  // Scroll to the last known position on mount (defaults to 8 AM).
  // Deferred to the next frame so the ScrollView content has finished layout.
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: scrollOffsetRef.current,
        animated: false,
      });
    });
  }, []);

  return (
    <View className="flex-1 bg-background">
      {/* Configure header options via Stack.Screen */}
      <Stack.Screen
        options={{
          title: "Calendar",
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
                    visibleDaysCount === n ? "bg-muted" : ""
                  }`}
                  key={n}
                  onPress={() => setVisibleDaysCount(n)}
                >
                  <Text
                    className={
                      visibleDaysCount === n
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground"
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
        }}
      />

      <GestureDetector gesture={swipeGesture}>
        <View className="flex-1">
          {/* Day headers */}
          <View className="flex-row border-border border-t border-b">
            <View
              className="border-border border-r"
              style={{ width: TIME_GUTTER_WIDTH_PX }}
            />
            <View className="flex-1 flex-row">
              {visibleDays.map((day) => {
                const isTodayHighlight = isToday(day, timeZone);
                const { weekday, dayNumber } = formatDayHeader(day);

                return (
                  <View
                    className={`flex-1 flex-row items-center justify-center gap-1.5 border-border border-r py-2 ${isTodayHighlight ? "bg-primary/5" : ""}`}
                    key={day.toString()}
                  >
                    <Text className="font-medium text-muted-foreground text-xs uppercase">
                      {weekday}
                    </Text>
                    <View
                      className={`size-6 items-center justify-center rounded-full ${isTodayHighlight ? "bg-primary" : ""}`}
                    >
                      <Text
                        className={`font-semibold text-sm ${isTodayHighlight ? "text-primary-foreground" : "text-foreground"}`}
                      >
                        {dayNumber}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* All-day events row */}
          {hasAllDayEvents ? (
            <View className="flex-row border-border border-b">
              <View
                className="border-border border-r"
                style={{ width: TIME_GUTTER_WIDTH_PX }}
              />
              <View className="flex-1 flex-row">
                {visibleDays.map((day) => {
                  const items = allDayEventsByDay.get(day.toString()) ?? [];
                  return (
                    <View
                      className="min-h-[38px] flex-1 gap-1 border-border border-r px-2 py-1.5"
                      key={`${day.toString()}-allday`}
                    >
                      {items.slice(0, 3).map((e) => (
                        <AllDayEventChip
                          item={e}
                          key={`${e.source.accountId}-${e.source.calendarId}-${e.source.event.id}`}
                          onPress={() => openEditAllDayEvent(e)}
                        />
                      ))}
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

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
                  const dayTasks = tasksByDay.get(dayKey) ?? [];
                  const isTodayColumn = isToday(day, timeZone);
                  const dayLayouts = collisionLayoutsByDay.get(dayKey);

                  return (
                    <Pressable
                      className="relative flex-1 border-border border-r"
                      key={dayKey}
                      onPress={(e) => {
                        const y = e.nativeEvent.locationY;
                        const minutes = (y / PIXELS_PER_HOUR) * 60;
                        openCreateEventAt(day, minutes);
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

                      {/* Google events */}
                      {dayEvents.map((evt) => {
                        const eventId = `${evt.source.accountId}-${evt.source.calendarId}-${evt.source.event.id}`;
                        const layout = dayLayouts?.get(eventId);
                        const startMinutes = minutesFromMidnight(evt.start);
                        const durationMinutes = Math.max(
                          MINUTES_STEP,
                          Math.round(
                            evt.end.since(evt.start).total({ unit: "minutes" })
                          )
                        );
                        const top = (startMinutes / 60) * PIXELS_PER_HOUR;
                        const height = Math.max(
                          (durationMinutes / 60) * PIXELS_PER_HOUR,
                          24
                        );
                        const adjustedTop = top + EVENT_BLOCK_INSET_PX / 2;
                        const adjustedHeight = Math.max(
                          height - EVENT_BLOCK_INSET_PX,
                          20
                        );

                        return (
                          <TimedGoogleEventBlock
                            columnIndex={layout?.columnIndex}
                            columnSpan={layout?.columnSpan}
                            durationMinutes={durationMinutes}
                            height={adjustedHeight}
                            item={evt}
                            key={`${eventId}-${evt.start.toString()}`}
                            onPress={() => openEditTimedEvent(evt)}
                            top={adjustedTop}
                            totalColumns={layout?.totalColumns}
                            zIndex={layout?.zIndex}
                          />
                        );
                      })}

                      {/* Scheduled tasks */}
                      {dayTasks.map((task) => {
                        if (!(task.startDate && task.startTime)) {
                          return null;
                        }
                        const layout = dayLayouts?.get(task.id);
                        const start = task.startDate.toZonedDateTime({
                          timeZone,
                          plainTime: task.startTime,
                        });
                        const startMinutes = minutesFromMidnight(start);
                        const durationMinutes = Math.max(
                          MINUTES_STEP,
                          task.durationMinutes
                        );
                        const top = (startMinutes / 60) * PIXELS_PER_HOUR;
                        const height = Math.max(
                          (durationMinutes / 60) * PIXELS_PER_HOUR,
                          24
                        );
                        const adjustedTop = top + EVENT_BLOCK_INSET_PX / 2;
                        const adjustedHeight = Math.max(
                          height - EVENT_BLOCK_INSET_PX,
                          20
                        );

                        // Calculate horizontal positioning based on collision layout.
                        // columnSpan lets items expand into adjacent empty columns.
                        const columnIndex = layout?.columnIndex ?? 0;
                        const totalColumns = layout?.totalColumns ?? 1;
                        const columnSpan = layout?.columnSpan ?? 1;
                        const zIndexValue = layout?.zIndex ?? 1;
                        const singleColumnWidth = 100 / totalColumns;
                        const columnWidthPercent =
                          singleColumnWidth * columnSpan;
                        const leftPercent = columnIndex * singleColumnWidth;
                        const end = start.add({ minutes: durationMinutes });

                        return (
                          <Pressable
                            className="absolute rounded-md bg-primary/90 px-1 py-1 shadow-black/5 shadow-sm"
                            key={task.id}
                            onPress={(e) => {
                              e.stopPropagation();
                              openEditTask(task);
                            }}
                            style={{
                              top: adjustedTop,
                              height: adjustedHeight,
                              left: `${leftPercent}%`,
                              width: `${columnWidthPercent}%`,
                              zIndex: zIndexValue,
                              borderColor: EVENT_OUTLINE_COLOR,
                              borderRadius: 6,
                              borderWidth: EVENT_OUTLINE_WIDTH_PX,
                            }}
                          >
                            <Text
                              className="font-semibold text-[10px] text-primary-foreground"
                              numberOfLines={1}
                            >
                              {task.title}
                            </Text>
                            {/* Show time for tasks 30 minutes or longer */}
                            {durationMinutes >= 30 ? (
                              <Text
                                className="text-[9px] text-primary-foreground/80"
                                numberOfLines={1}
                              >
                                {formatTimeShort(start)} -{" "}
                                {formatTimeShort(end)}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}

                      {/* Current time indicator (today only) */}
                      {isTodayColumn ? (
                        <CurrentTimeIndicator timeZone={timeZone} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </GestureDetector>

      {/* Calendar visibility picker */}
      <CalendarPickerModal
        googleAccounts={googleAccounts}
        googleCalendars={googleCalendars}
        onClose={() => setIsPickerOpen(false)}
        open={isPickerOpen}
        setVisibleCalendars={setVisibleCalendars}
        visibleCalendars={effectiveVisibleCalendars}
      />

      {eventDraft?.mode === "create" ? (
        <CreateEventEditorSheet
          calendarOptions={allCalendarOptions}
          draft={eventDraft}
          isVisible
          onClose={closeEventModal}
          onCreate={(draft) => {
            saveEvent(draft).catch(() => null);
          }}
          timeZone={timeZone}
        />
      ) : null}

      {eventDraft?.mode === "edit" ? (
        <EditEventEditorSheet
          calendarOptions={editCalendarOptions}
          draft={eventDraft}
          isVisible
          onClose={closeEventModal}
          onDelete={(draft) => {
            requestDeleteEvent(draft);
          }}
          onSave={(draft) => {
            saveEvent(draft).catch(() => null);
          }}
          timeZone={timeZone}
        />
      ) : null}

      <TaskEditorSheet
        draft={taskDraft}
        isVisible={editingTask !== null && taskDraft !== null}
        mode="edit"
        onClose={closeTaskModal}
        onDelete={deleteTaskFromCalendar}
        onSave={saveTask}
        onToggleDone={toggleTaskStatusFromCalendar}
        setDraft={(updater) =>
          setTaskDraft((current) => (current ? updater(current) : current))
        }
        timeZone={timeZone}
      />

      <AlertDialog
        confirmText="Apply"
        description={
          pendingEventSaveDraft &&
          pendingEventSaveDraft.calendar.calendarId !==
            pendingEventSaveDraft.sourceCalendar.calendarId
            ? "Moving to a different calendar applies to all events in the series."
            : "This is a recurring event. Choose how broadly to apply these changes."
        }
        isVisible={isEventSaveScopeDialogVisible}
        onCancel={() => {
          setIsEventSaveScopeDialogVisible(false);
          setPendingEventSaveDraft(null);
        }}
        onClose={() => {
          setIsEventSaveScopeDialogVisible(false);
          setPendingEventSaveDraft(null);
        }}
        onConfirm={() => {
          confirmScopedEventSave().catch(() => null);
        }}
        title="Save recurring event"
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) =>
              setEventSaveScope(value as RecurrenceScope)
            }
            options={RECURRENCE_SCOPE_OPTIONS.map((option) => {
              // Google API only supports moving the entire series,
              // so disable "this" and "following" when calendar changed.
              const isMoving =
                pendingEventSaveDraft != null &&
                pendingEventSaveDraft.calendar.calendarId !==
                  pendingEventSaveDraft.sourceCalendar.calendarId;
              const disabled =
                isMoving &&
                (option.value === "this" || option.value === "following");
              return {
                value: option.value,
                label: option.label,
                disabled,
              };
            })}
            value={eventSaveScope}
          />
        </View>
      </AlertDialog>

      <AlertDialog
        confirmText="Delete"
        description="This is a recurring event. Choose what to delete."
        isVisible={isEventDeleteScopeDialogVisible}
        onClose={() => {
          setIsEventDeleteScopeDialogVisible(false);
          setPendingEventDeleteDraft(null);
        }}
        onConfirm={() => {
          confirmScopedEventDelete().catch(() => null);
        }}
        title="Delete recurring event"
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) =>
              setEventDeleteScope(value as RecurrenceScope)
            }
            options={RECURRENCE_SCOPE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={eventDeleteScope}
          />
        </View>
      </AlertDialog>

      <AlertDialog
        confirmText="Delete"
        description="This action cannot be undone."
        isVisible={isSimpleEventDeleteDialogVisible}
        onClose={() => {
          setIsSimpleEventDeleteDialogVisible(false);
          setPendingEventDeleteDraft(null);
        }}
        onConfirm={() => {
          confirmSimpleEventDelete().catch(() => null);
        }}
        title="Delete event"
      />

      <AlertDialog
        confirmText="Apply"
        description="This is a recurring task. Choose how broadly to apply these updates."
        isVisible={isTaskSaveScopeDialogVisible}
        onCancel={closeTaskModal}
        onClose={closeTaskModal}
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
        onClose={closeTaskModal}
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
    </View>
  );
}
