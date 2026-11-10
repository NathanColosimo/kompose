import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
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
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { isCalendarVisible } from "@kompose/state/atoms/visible-calendars";
import {
  calculateCollisionLayout,
  type ItemLayout,
  type PositionedItem,
} from "@kompose/state/collision-utils";
import {
  GOOGLE_CALENDARS_QUERY_KEY,
  getGoogleEventsByCalendarQueryKey,
} from "@kompose/state/google-calendar-query-keys";
import {
  getDefaultRecurrenceScopeForEvent,
  isRecurringGoogleEvent,
} from "@kompose/state/google-event-recurrence";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useMoveGoogleEventMutation } from "@kompose/state/hooks/use-move-google-event-mutation";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { RECURRENCE_SCOPE_OPTIONS } from "@kompose/state/recurrence-scope-options";
import { todayPlainDate } from "@kompose/state/temporal-utils";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router/stack";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
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
import { EventEditorSheet } from "@/components/calendar/calendar-event-editor-sheet";
import { CalendarPickerModal } from "@/components/calendar/calendar-picker-modal";
import {
  type TaskDraft,
  TaskEditorSheet,
} from "@/components/tasks/task-editor-sheet";
import { TaskScopeDialogs } from "@/components/tasks/task-scope-dialogs";
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

function CurrentTimeIndicator({ timeZone }: { timeZone: string }) {
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

type EventDialog = "save" | "delete" | "simple-delete" | null;

interface GoogleEventSource {
  accountId: string;
  calendarBackgroundColor: string | null;
  calendarColorId: string | null;
  calendarForegroundColor: string | null;
  calendarId: string;
  event: GoogleEvent;
}

interface PositionedGoogleEvent {
  end: Temporal.ZonedDateTime;
  source: GoogleEventSource;
  start: Temporal.ZonedDateTime;
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
  const snapped = snapMinutes(minutes);

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

function AllDayEventChip({
  item,
  onPress,
}: {
  item: AllDayGoogleEvent;
  onPress: () => void;
}) {
  const { background, foreground } = useGoogleEventColors(item.source);

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
  const { background, foreground } = useGoogleEventColors(item.source);

  // Shared column-span layout: see packages/state/src/collision-utils.ts.
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
        backgroundColor: background,
        borderColor: EVENT_OUTLINE_COLOR,
        borderRadius: 6,
        borderWidth: EVENT_OUTLINE_WIDTH_PX,
        height,
        left: `${leftPercent}%`,
        top,
        width: `${columnWidthPercent}%`,
        zIndex,
      }}
    >
      <Text
        className="font-semibold text-[10px]"
        numberOfLines={1}
        style={{ color: foreground }}
      >
        {item.source.event.summary ?? "Event"}
      </Text>
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
  const setCurrentDate = useSetAtom(currentDateAtom);
  const [visibleDaysCount, setVisibleDaysCount] = useAtom(
    mobileVisibleDaysCountAtom
  );
  const visibleDays = useAtomValue(mobileVisibleDaysAtom);
  const windows = useAtomValue(eventWindowsAtom);

  // Tasks: use the same query source as mutations to avoid stale editor state.
  const { tasksQuery } = useTasks();
  const tasks = tasksQuery.data ?? [];

  const scheduledTasks = useMemo(
    () => tasks.filter((t) => t.startDate !== null && t.startTime !== null),
    [tasks]
  );

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

  const { events: googleEvents, isFetching: isFetchingGoogleEvents } =
    useGoogleEvents({
      visibleCalendars: visibleCalendarIds,
      windows,
    });

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
        const date = Temporal.PlainDate.from(startDate);
        const bucket = allDay.get(date.toString());
        if (bucket) {
          bucket.push({ date, source });
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
          bucket.push({ end, source, start });
        }
      } catch {
        // Skip unparseable events.
      }
    }

    return { allDayEventsByDay: allDay, timedEventsByDay: timed };
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

      const taskItems: PositionedItem[] = dayTasks
        .filter((task) => task.startDate !== null && task.startTime !== null)
        .map((task) => {
          const start = task.startDate?.toZonedDateTime({
            plainTime:
              task.startTime ??
              Temporal.PlainTime.from({ hour: 0, minute: 0, second: 0 }),
            timeZone,
          });
          const startMinutes = start ? minutesFromMidnight(start) : 0;
          const endMinutes = startMinutes + (task.durationMinutes || 30);
          return {
            endMinutes,
            id: task.id,
            startMinutes,
            type: "task" as const,
          };
        });

      const googleItems: PositionedItem[] = dayGoogleEvents.map((ge) => {
        const startMinutes = minutesFromMidnight(ge.start);
        const endMinutes = minutesFromMidnight(ge.end);
        return {
          endMinutes,
          id: `${ge.source.accountId}-${ge.source.calendarId}-${ge.source.event.id}`,
          startMinutes,
          type: "google-event" as const,
        };
      });

      const allItems = [...taskItems, ...googleItems];
      const layout = calculateCollisionLayout(allItems);
      layoutsByDay.set(dayKey, layout);
    }

    return layoutsByDay;
  }, [visibleDays, tasksByDay, timedEventsByDay, timeZone]);

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

  const taskFlow = useTaskEditorFlow();
  const openCreateTask = taskFlow.openCreate;
  const [createSlotSelection, setCreateSlotSelection] = useState<{
    day: Temporal.PlainDate;
    minutes: number;
  } | null>(null);
  const [pendingCreateAction, setPendingCreateAction] = useState<{
    kind: "event" | "task";
    day: Temporal.PlainDate;
    minutes: number;
  } | null>(null);

  const allCalendarOptions = useMemo<CalendarOption[]>(
    () =>
      googleCalendars.map((calendar) => ({
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

  const defaultCalendar = visibleCalendarOptions[0] ?? allCalendarOptions[0];
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
      const snapped = snapMinutes(minutes);
      const startTime = Temporal.PlainTime.from({
        hour: Math.floor(snapped / 60),
        minute: snapped % 60,
        second: 0,
      });
      const endTime = startTime.add({ minutes: 30 });
      const createDraft: CreateEventDraft = {
        allDay: false,
        calendar: {
          accountId: defaultCalendar.accountId,
          calendarId: defaultCalendar.calendarId,
        },
        colorId: null,
        conferenceData: null,
        description: "",
        endDate: day,
        endTime,
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
      setCreateSlotSelection({ day, minutes: snapMinutes(minutes) });
    },
    []
  );

  const closeCreateChooser = useCallback(() => {
    setCreateSlotSelection(null);
  }, []);

  useEffect(() => {
    if (createSlotSelection !== null || pendingCreateAction === null) {
      return;
    }

    // Wait for the chooser bottom-sheet modal to finish closing before opening
    // the next sheet. Otherwise the closing modal can swallow the new one.
    const timeoutId = setTimeout(() => {
      if (pendingCreateAction.kind === "event") {
        openCreateEventAt(pendingCreateAction.day, pendingCreateAction.minutes);
      } else {
        openCreateTaskAt(pendingCreateAction.day, pendingCreateAction.minutes);
      }
      setPendingCreateAction(null);
    }, 320);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    createSlotSelection,
    openCreateEventAt,
    openCreateTaskAt,
    pendingCreateAction,
  ]);

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
        colorId: currentDraft.colorId ?? undefined,
        conferenceData: currentDraft.conferenceData ?? undefined,
        description: currentDraft.description.trim() || undefined,
        end: endPayload,
        location: currentDraft.location.trim() || undefined,
        recurrence:
          currentDraft.recurrence.length > 0
            ? currentDraft.recurrence
            : undefined,
        start: startPayload,
        summary: currentDraft.summary.trim(),
      };
    },
    [timeZone]
  );

  const commitEventUpdate = useCallback(
    async (draft: EditEventDraft, scope: RecurrenceScope) => {
      const sourceCalendar = draft.sourceCalendar;
      const destinationCalendarId =
        draft.calendar.calendarId === sourceCalendar.calendarId
          ? null
          : draft.calendar.calendarId;
      const eventPayload = buildEventPayload(draft);
      await updateEvent.mutateAsync({
        accountId: sourceCalendar.accountId,
        calendarId: sourceCalendar.calendarId,
        event: {
          ...draft.sourceEvent,
          ...eventPayload,
          end: {
            ...draft.sourceEvent.end,
            ...eventPayload.end,
          },
          start: {
            ...draft.sourceEvent.start,
            ...eventPayload.start,
          },
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
    [buildEventPayload, closeEventModal, moveEvent, updateEvent]
  );

  const saveEvent = useCallback(
    async (draft: EventDraft) => {
      if (!draft.summary.trim()) {
        return;
      }

      if (draft.mode === "create") {
        await createEvent.mutateAsync({
          accountId: draft.calendar.accountId,
          calendarId: draft.calendar.calendarId,
          event: buildEventPayload(draft),
        });
        closeEventModal();
        return;
      }

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
          draft.calendar.calendarId !== draft.sourceCalendar.calendarId;
        const defaultScope = hasCalendarChange
          ? "all"
          : getDefaultRecurrenceScopeForEvent({
              event: draft.sourceEvent,
              masterRecurrence: masterSeriesRecurrence,
            });
        setPendingEventSaveDraft(draft);
        setEventSaveScope(defaultScope);
        setEventDraft(null);
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
      masterRecurrence,
    ]
  );

  const confirmScopedEventSave = useCallback(async () => {
    if (!pendingEventSaveDraft) {
      return;
    }
    await commitEventUpdate(pendingEventSaveDraft, eventSaveScope);
  }, [commitEventUpdate, eventSaveScope, pendingEventSaveDraft]);

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
        setEventDialog("delete");
        return;
      }

      setEventDialog("simple-delete");
    },
    [masterRecurrence]
  );

  const confirmEventDelete = useCallback(
    async (scope: RecurrenceScope) => {
      if (!pendingEventDeleteDraft) {
        return;
      }

      await deleteEvent.mutateAsync({
        accountId: pendingEventDeleteDraft.sourceCalendar.accountId,
        calendarId: pendingEventDeleteDraft.sourceCalendar.calendarId,
        eventId: pendingEventDeleteDraft.eventId,
        scope,
      });
      closeEventModal();
    },
    [closeEventModal, deleteEvent, pendingEventDeleteDraft]
  );

  const totalHeight = 24 * PIXELS_PER_HOUR;
  const scrollRef = useRef<ScrollViewInstance>(null);

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
      queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    });
    queryClient.invalidateQueries({
      queryKey: GOOGLE_CALENDARS_QUERY_KEY,
    });

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
    isFetchingCalendars > 0;

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

  // Defer the initial 8 AM scroll until the time grid has laid out.
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
          title: "Calendar",
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
                          plainTime: task.startTime,
                          timeZone,
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
                              taskFlow.openEdit(task);
                            }}
                            style={{
                              borderColor: EVENT_OUTLINE_COLOR,
                              borderRadius: 6,
                              borderWidth: EVENT_OUTLINE_WIDTH_PX,
                              height: adjustedHeight,
                              left: `${leftPercent}%`,
                              top: adjustedTop,
                              width: `${columnWidthPercent}%`,
                              zIndex: zIndexValue,
                            }}
                          >
                            <Text
                              className="font-semibold text-[10px] text-primary-foreground"
                              numberOfLines={1}
                            >
                              {task.title}
                            </Text>
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

      <CalendarPickerModal
        onClose={() => setIsPickerOpen(false)}
        open={isPickerOpen}
      />

      {eventDraft ? (
        <EventEditorSheet
          calendarOptions={eventCalendarOptions}
          draft={eventDraft}
          onClose={closeEventModal}
          onDelete={requestDeleteEvent}
          onSubmit={(draft) => {
            saveEvent(draft).catch(() => null);
          }}
        />
      ) : null}

      <BottomSheet
        isVisible={createSlotSelection !== null}
        onClose={closeCreateChooser}
        snapPoints={[0.34, 0.42]}
        title="Create"
      >
        <Text className="mb-3 text-muted-foreground text-sm">
          Create an event or a scheduled task for this time slot.
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
              Event creation needs at least one writable calendar.
            </Text>
          )}
        </View>
      </BottomSheet>

      <TaskEditorSheet
        canSave={taskFlow.canSave}
        // Drop the content as soon as it closes rather than animating it out.
        draft={taskFlow.isEditorOpen ? taskFlow.draft : null}
        isSaving={taskFlow.isSaving}
        isVisible={taskFlow.isEditorOpen}
        mode={taskFlow.editingTask ? "edit" : "create"}
        onClose={taskFlow.close}
        onDelete={taskFlow.editingTask ? taskFlow.requestDelete : undefined}
        onSave={taskFlow.save}
        onToggleDone={taskFlow.editingTask ? taskFlow.toggleDone : undefined}
        overlay={<TaskScopeDialogs flow={taskFlow} />}
        setDraft={taskFlow.updateDraft}
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
        isVisible={eventDialog === "save"}
        onCancel={dismissEventSaveDialog}
        onClose={dismissEventSaveDialog}
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
              // Google can only move a whole series to another calendar, so
              // "this" and "following" are disabled when the calendar changes.
              const isMoving =
                pendingEventSaveDraft != null &&
                pendingEventSaveDraft.calendar.calendarId !==
                  pendingEventSaveDraft.sourceCalendar.calendarId;
              const disabled =
                isMoving &&
                (option.value === "this" || option.value === "following");
              return {
                disabled,
                label: option.label,
                value: option.value,
              };
            })}
            value={eventSaveScope}
          />
        </View>
      </AlertDialog>

      <AlertDialog
        confirmText="Delete"
        description="This is a recurring event. Choose what to delete."
        isVisible={eventDialog === "delete"}
        onClose={dismissEventDeleteDialog}
        onConfirm={() => {
          confirmEventDelete(eventDeleteScope).catch(() => null);
        }}
        title="Delete recurring event"
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) =>
              setEventDeleteScope(value as RecurrenceScope)
            }
            options={RECURRENCE_SCOPE_OPTIONS}
            value={eventDeleteScope}
          />
        </View>
      </AlertDialog>

      <AlertDialog
        confirmText="Delete"
        description="This action cannot be undone."
        isVisible={eventDialog === "simple-delete"}
        onClose={dismissEventDeleteDialog}
        onConfirm={() => {
          confirmEventDelete("this").catch(() => null);
        }}
        title="Delete event"
      />
    </View>
  );
}
