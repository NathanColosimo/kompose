import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
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
import { tasksDataAtom } from "@kompose/state/atoms/tasks";
import {
  type CalendarIdentifier,
  isCalendarVisible,
  type VisibleCalendars,
  visibleCalendarsAtom,
} from "@kompose/state/atoms/visible-calendars";
import { useEnsureVisibleCalendars } from "@kompose/state/hooks/use-ensure-visible-calendars";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useLocationSearch } from "@kompose/state/hooks/use-location-search";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { getMapsSearchUrl } from "@kompose/state/locations";
import {
  buildGoogleMeetConferenceData,
  extractMeetingLink,
} from "@kompose/state/meeting";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router/stack";
import { useAtom, useAtomValue } from "jotai";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
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
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/color-scheme-context";
import { orpc } from "@/utils/orpc";

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

function isToday(date: Temporal.PlainDate): boolean {
  const today = Temporal.Now.plainDateISO();
  return Temporal.PlainDate.compare(date, today) === 0;
}

function formatDayHeader(date: Temporal.PlainDate): {
  weekday: string;
  dayNumber: number;
} {
  const weekday = date.toLocaleString(undefined, { weekday: "short" });
  return { weekday, dayNumber: date.day };
}

function calculateTimePosition(): number {
  const now = Temporal.Now.zonedDateTimeISO();
  return (now.hour + now.minute / 60) * PIXELS_PER_HOUR;
}

function CurrentTimeIndicator() {
  const [topPosition, setTopPosition] = useState(() => calculateTimePosition());

  useEffect(() => {
    // Update position immediately, then every minute.
    setTopPosition(calculateTimePosition());
    const interval = setInterval(() => {
      setTopPosition(calculateTimePosition());
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

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

// --- Collision detection utilities ---

const SIDE_BY_SIDE_THRESHOLD_MINUTES = 45;
const MAX_COLUMNS = 2;

interface PositionedItem {
  id: string;
  type: "task" | "google-event";
  startMinutes: number;
  endMinutes: number;
}

interface ItemLayout {
  columnIndex: number;
  totalColumns: number;
  zIndex: number;
}

function itemsOverlap(a: PositionedItem, b: PositionedItem): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

function findCollisionCluster(
  item: PositionedItem,
  allItems: PositionedItem[],
  visited: Set<string>
): PositionedItem[] {
  const cluster: PositionedItem[] = [item];
  visited.add(item.id);

  for (const other of allItems) {
    if (visited.has(other.id)) {
      continue;
    }
    const overlapsCluster = cluster.some((clusterItem) =>
      itemsOverlap(clusterItem, other)
    );
    if (overlapsCluster) {
      visited.add(other.id);
      const subCluster = findCollisionCluster(other, allItems, visited);
      cluster.push(...subCluster.filter((i) => i.id !== other.id));
      cluster.push(other);
    }
  }

  return cluster;
}

function assignColumnsToCluster(
  cluster: PositionedItem[]
): Map<string, { columnIndex: number; zIndex: number }> {
  const sorted = [...cluster].sort((a, b) => a.startMinutes - b.startMinutes);
  const result = new Map<string, { columnIndex: number; zIndex: number }>();
  const columnEndTimes: number[] = [];

  const earliestStart = sorted[0].startMinutes;
  const latestStart = sorted.at(-1)?.startMinutes ?? earliestStart;
  const useSideBySide =
    latestStart - earliestStart < SIDE_BY_SIDE_THRESHOLD_MINUTES;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    let assignedColumn = 0;

    if (useSideBySide) {
      for (let col = 0; col < columnEndTimes.length; col++) {
        if (item.startMinutes >= columnEndTimes[col]) {
          assignedColumn = col;
          break;
        }
        assignedColumn = col + 1;
      }
      if (assignedColumn >= MAX_COLUMNS) {
        assignedColumn = MAX_COLUMNS - 1;
      }
    }

    if (assignedColumn >= columnEndTimes.length) {
      columnEndTimes.push(item.endMinutes);
    } else {
      columnEndTimes[assignedColumn] = Math.max(
        columnEndTimes[assignedColumn],
        item.endMinutes
      );
    }

    result.set(item.id, { columnIndex: assignedColumn, zIndex: i + 1 });
  }

  return result;
}

function calculateCollisionLayout(
  items: PositionedItem[]
): Map<string, ItemLayout> {
  if (items.length === 0) {
    return new Map();
  }

  const sortedItems = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes
  );

  const result = new Map<string, ItemLayout>();
  const visited = new Set<string>();

  for (const item of sortedItems) {
    if (visited.has(item.id)) {
      continue;
    }

    const cluster = findCollisionCluster(item, sortedItems, visited);

    if (cluster.length === 1) {
      result.set(item.id, { columnIndex: 0, totalColumns: 1, zIndex: 1 });
      continue;
    }

    const clusterSorted = [...cluster].sort(
      (a, b) => a.startMinutes - b.startMinutes
    );
    const earliestStart = clusterSorted[0].startMinutes;
    const latestStart = clusterSorted.at(-1)?.startMinutes ?? earliestStart;
    const useSideBySide =
      latestStart - earliestStart < SIDE_BY_SIDE_THRESHOLD_MINUTES;

    const columnAssignments = assignColumnsToCluster(cluster);

    let maxColumn = 0;
    for (const { columnIndex } of columnAssignments.values()) {
      maxColumn = Math.max(maxColumn, columnIndex);
    }
    const totalColumns = useSideBySide ? maxColumn + 1 : 1;

    for (const clusterItem of cluster) {
      const assignment = columnAssignments.get(clusterItem.id);
      if (assignment) {
        result.set(clusterItem.id, {
          columnIndex: useSideBySide ? assignment.columnIndex : 0,
          totalColumns,
          zIndex: assignment.zIndex,
        });
      }
    }
  }

  return result;
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

function snapMinutes(mins: number): number {
  const snapped = Math.round(mins / MINUTES_STEP) * MINUTES_STEP;
  return Math.max(0, Math.min(24 * 60 - MINUTES_STEP, snapped));
}

function isoStringToZonedDateTime(str: string, timeZone: string) {
  const instant = Temporal.Instant.from(str);
  return instant.toZonedDateTimeISO(timeZone);
}

interface PositionedGoogleEvent {
  source: { accountId: string; calendarId: string; event: GoogleEvent };
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
}

interface AllDayGoogleEvent {
  source: { accountId: string; calendarId: string; event: GoogleEvent };
  date: Temporal.PlainDate;
}

function buildDraftFromTask(task: TaskSelectDecoded): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    tagIds: task.tags.map((tag) => tag.id),
    durationMinutes: task.durationMinutes,
    dueDate: task.dueDate,
    startDate: task.startDate,
    startTime: task.startTime,
  };
}

function AllDayEventChip({
  item,
  calendarColors,
  onPress,
}: {
  item: AllDayGoogleEvent;
  calendarColors?: { background?: string | null; foreground?: string | null };
  onPress: () => void;
}) {
  const palette = useAtomValue(
    normalizedGoogleColorsAtomFamily(item.source.accountId)
  );
  const { background, foreground } = resolveGoogleEventColors({
    colorId: item.source.event.colorId,
    palette: palette?.event,
    calendarBackgroundColor: calendarColors?.background,
    calendarForegroundColor: calendarColors?.foreground,
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
  calendarColors,
  top,
  height,
  durationMinutes,
  columnIndex = 0,
  totalColumns = 1,
  zIndex = 1,
  onPress,
}: {
  item: PositionedGoogleEvent;
  calendarColors?: { background?: string | null; foreground?: string | null };
  top: number;
  height: number;
  durationMinutes: number;
  columnIndex?: number;
  totalColumns?: number;
  zIndex?: number;
  onPress: () => void;
}) {
  const palette = useAtomValue(
    normalizedGoogleColorsAtomFamily(item.source.accountId)
  );
  const { background, foreground } = resolveGoogleEventColors({
    colorId: item.source.event.colorId,
    palette: palette?.event,
    calendarBackgroundColor: calendarColors?.background,
    calendarForegroundColor: calendarColors?.foreground,
  });

  // Calculate horizontal positioning based on collision layout.
  const columnWidthPercent = 100 / totalColumns;
  const leftPercent = columnIndex * columnWidthPercent;

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

  // Shared atoms for calendar state (mobile variants clamp to 1-3 days).
  const timeZone = useAtomValue(timezoneAtom);
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [visibleDaysCount, setVisibleDaysCount] = useAtom(
    mobileVisibleDaysCountAtom
  );
  const visibleDays = useAtomValue(mobileVisibleDaysAtom);
  const window = useAtomValue(eventWindowAtom);

  const getEventsQueryKey = useCallback(
    (calendar: CalendarIdentifier) =>
      orpc.googleCal.events.list.queryOptions({
        input: {
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
          timeMin: window.timeMin,
          timeMax: window.timeMax,
        },
      }).queryKey,
    [window.timeMax, window.timeMin]
  );

  // Tasks: use atom for data, hook only for mutations.
  const tasks = useAtomValue(tasksDataAtom);
  const { tasksQuery, updateTask, deleteTask } = useTasks();

  const scheduledTasks = useMemo(
    () => tasks.filter((t) => t.startDate !== null && t.startTime !== null),
    [tasks]
  );

  // Google accounts/calendars/events.
  const googleAccounts = useAtomValue(googleAccountsDataAtom);
  const accountIds = useMemo(
    () => googleAccounts.map((a) => a.id),
    [googleAccounts]
  );

  const googleCalendars = useAtomValue(googleCalendarsDataAtom);
  const calendarColorLookup = useMemo(() => {
    const lookup = new Map<
      string,
      { background?: string | null; foreground?: string | null }
    >();
    for (const calendar of googleCalendars) {
      lookup.set(`${calendar.accountId}:${calendar.calendar.id}`, {
        background: calendar.calendar.backgroundColor ?? null,
        foreground: calendar.calendar.foregroundColor ?? null,
      });
    }
    return lookup;
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

  useEnsureVisibleCalendars(allCalendarIds);

  const visibleCalendarIds = useAtomValue(resolvedVisibleCalendarIdsAtom);

  const { events: googleEvents, isFetching: isFetchingGoogleEvents } =
    useGoogleEvents({
      visibleCalendars: visibleCalendarIds,
      window,
    });
  const isFetchingAccounts = useIsFetching({
    queryKey: ["google-accounts"],
  });
  const isFetchingCalendars = useIsFetching({
    queryKey: ["google-calendars"],
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
      const startDate = item.event.start.date;
      const startDateTime = item.event.start.dateTime;
      const endDateTime = item.event.end.dateTime;

      if (startDate && !startDateTime && !endDateTime) {
        const date = Temporal.PlainDate.from(startDate);
        const bucket = allDay.get(date.toString());
        if (bucket) {
          bucket.push({ source: item, date });
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
          bucket.push({ source: item, start, end });
        }
      } catch {
        // Skip unparseable events.
      }
    }

    return { timedEventsByDay: timed, allDayEventsByDay: allDay };
  }, [googleEvents, timeZone, visibleDays]);

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
          const start = task.startDate!.toZonedDateTime({
            timeZone,
            plainTime: task.startTime!,
          });
          const startMinutes = minutesFromMidnight(start);
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
          id: `${ge.source.calendarId}-${ge.source.event.id}`,
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
  // Tracks whether location suggestions dropdown should be visible (dismissed after selection).
  const [locationSuggestionsOpen, setLocationSuggestionsOpen] = useState(false);
  const locationQuery = eventDraft?.location ?? "";
  const locationSearch = useLocationSearch(locationQuery);
  const locationSuggestions = locationSearch.data ?? [];
  const showLocationSuggestions =
    locationSuggestionsOpen &&
    Boolean(eventDraft) &&
    locationQuery.trim().length >= 2 &&
    locationSuggestions.length > 0;

  const meetingSource = useMemo(() => {
    if (!eventDraft) {
      return null;
    }
    const sourceEvent = isEditEventDraft(eventDraft)
      ? eventDraft.sourceEvent
      : undefined;
    // Distinguish undefined (not touched) from null (explicitly cleared).
    // Convert null to undefined for type compatibility with extractMeetingLink.
    const resolvedConferenceData =
      eventDraft.conferenceData === undefined
        ? sourceEvent?.conferenceData
        : (eventDraft.conferenceData ?? undefined);

    return {
      ...(sourceEvent ?? {}),
      location: eventDraft.location,
      description: eventDraft.description,
      conferenceData: resolvedConferenceData,
    };
  }, [eventDraft]);

  const meetingLink = useMemo(
    () => extractMeetingLink(meetingSource),
    [meetingSource]
  );
  const mapsUrl =
    eventDraft && eventDraft.location.trim().length
      ? getMapsSearchUrl(eventDraft.location)
      : null;
  const isConferencePending = Boolean(
    eventDraft?.conferenceData?.createRequest && !meetingLink
  );

  // Edit scheduled task modal state.
  const [editingTask, setEditingTask] = useState<TaskSelectDecoded | null>(
    null
  );
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);

  const calendarOptions = useMemo<CalendarOption[]>(() => {
    const visible = googleCalendars.filter((c) =>
      isCalendarVisible(effectiveVisibleCalendars, c.accountId, c.calendar.id)
    );
    return visible.map((c) => ({
      accountId: c.accountId,
      calendarId: c.calendar.id,
      label: c.calendar.summary ?? "Calendar",
    }));
  }, [effectiveVisibleCalendars, googleCalendars]);

  const defaultCalendar = calendarOptions[0];

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
        calendar: {
          accountId: defaultCalendar.accountId,
          calendarId: defaultCalendar.calendarId,
        },
        allDay: false,
        startDate: day,
        endDate: day,
        startTime,
        endTime,
        conferenceData: null,
      };
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
      calendar: {
        accountId: item.source.accountId,
        calendarId: item.source.calendarId,
      },
      allDay: false,
      startDate: item.start.toPlainDate(),
      endDate: item.end.toPlainDate(),
      startTime: item.start.toPlainTime(),
      endTime: item.end.toPlainTime(),
      conferenceData: item.source.event.conferenceData ?? null,
      sourceEvent: item.source.event,
    };
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
      calendar: {
        accountId: item.source.accountId,
        calendarId: item.source.calendarId,
      },
      allDay: true,
      startDate,
      endDate,
      startTime: null,
      endTime: null,
      conferenceData: item.source.event.conferenceData ?? null,
      sourceEvent: item.source.event,
    };
    setEventDraft(editDraft);
  }, []);

  const closeEventModal = useCallback(() => {
    setLocationSuggestionsOpen(false);
    setEventDraft(null);
  }, []);

  const addGoogleMeetToEventDraft = useCallback(() => {
    setEventDraft((current) =>
      current
        ? {
            ...current,
            conferenceData: buildGoogleMeetConferenceData(),
          }
        : current
    );
  }, []);

  const saveEvent = useCallback(async () => {
    if (!eventDraft) {
      return;
    }
    if (!eventDraft.summary.trim()) {
      return;
    }

    // Build start/end payloads based on whether it's an all-day event.
    let startPayload: { date?: string; dateTime?: string };
    let endPayload: { date?: string; dateTime?: string };

    if (eventDraft.allDay) {
      // All-day events use date strings; Google uses exclusive end date.
      startPayload = { date: eventDraft.startDate.toString() };
      endPayload = {
        date: eventDraft.endDate.add({ days: 1 }).toString(),
      };
    } else {
      // Timed events use dateTime ISO strings.
      const startZdt = combineDateTime(
        eventDraft.startDate,
        eventDraft.startTime ?? Temporal.PlainTime.from("09:00"),
        timeZone
      );
      const endZdt = combineDateTime(
        eventDraft.endDate,
        eventDraft.endTime ?? Temporal.PlainTime.from("10:00"),
        timeZone
      );
      startPayload = { dateTime: startZdt.toInstant().toString() };
      endPayload = { dateTime: endZdt.toInstant().toString() };
    }

    const eventPayload = {
      summary: eventDraft.summary.trim(),
      description: eventDraft.description.trim() || undefined,
      location: eventDraft.location.trim() || undefined,
      conferenceData: eventDraft.conferenceData ?? undefined,
      start: startPayload,
      end: endPayload,
    };

    if (eventDraft.mode === "create") {
      await orpc.googleCal.events.create.call({
        accountId: eventDraft.calendar.accountId,
        calendarId: eventDraft.calendar.calendarId,
        event: eventPayload,
      });
    } else {
      await orpc.googleCal.events.update.call({
        accountId: eventDraft.calendar.accountId,
        calendarId: eventDraft.calendar.calendarId,
        eventId: eventDraft.eventId,
        scope: "this",
        event: eventPayload,
      });
    }

    queryClient.invalidateQueries({
      queryKey: getEventsQueryKey(eventDraft.calendar),
    });
    closeEventModal();
  }, [closeEventModal, eventDraft, getEventsQueryKey, queryClient]);

  const deleteEvent = useCallback(async () => {
    if (!(eventDraft && isEditEventDraft(eventDraft))) {
      return;
    }
    await orpc.googleCal.events.delete.call({
      accountId: eventDraft.calendar.accountId,
      calendarId: eventDraft.calendar.calendarId,
      eventId: eventDraft.eventId,
      scope: "this",
    });
    queryClient.invalidateQueries({
      queryKey: getEventsQueryKey(eventDraft.calendar),
    });
    closeEventModal();
  }, [closeEventModal, eventDraft, getEventsQueryKey, queryClient]);

  const openEditTask = useCallback((task: TaskSelectDecoded) => {
    setEditingTask(task);
    setTaskDraft(buildDraftFromTask(task));
  }, []);

  const closeTaskModal = useCallback(() => {
    setEditingTask(null);
    setTaskDraft(null);
  }, []);

  const saveTask = useCallback(() => {
    if (!(editingTask && taskDraft)) {
      return;
    }
    updateTask.mutate({
      id: editingTask.id,
      scope: "this",
      task: {
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim()
          ? taskDraft.description.trim()
          : null,
        tagIds: taskDraft.tagIds,
        durationMinutes: taskDraft.durationMinutes,
        dueDate: taskDraft.dueDate,
        startDate: taskDraft.startDate,
        startTime: taskDraft.startTime,
      },
    });
    closeTaskModal();
  }, [closeTaskModal, editingTask, taskDraft, updateTask]);

  const deleteTaskFromCalendar = useCallback(() => {
    if (!editingTask) {
      return;
    }
    deleteTask.mutate({ id: editingTask.id, scope: "this" });
    closeTaskModal();
  }, [closeTaskModal, deleteTask, editingTask]);

  const toggleTaskStatusFromCalendar = useCallback(() => {
    if (!editingTask) {
      return;
    }
    const nextStatus = editingTask.status === "done" ? "todo" : "done";
    updateTask.mutate({
      id: editingTask.id,
      scope: "this",
      task: { status: nextStatus },
    });
    closeTaskModal();
  }, [closeTaskModal, editingTask, updateTask]);

  const totalHeight = 24 * PIXELS_PER_HOUR;
  const scrollRef = useRef<ScrollView>(null);

  const refreshCalendarData = useCallback(() => {
    tasksQuery.refetch();
    queryClient.invalidateQueries({
      queryKey: ["google-accounts"],
    });
    queryClient.invalidateQueries({
      queryKey: ["google-calendars"],
    });

    // Only refresh visible calendars and the active window to avoid broad invalidation.
    for (const calendar of visibleCalendarIds) {
      queryClient.invalidateQueries({
        queryKey: getEventsQueryKey(calendar),
      });
    }
  }, [getEventsQueryKey, queryClient, tasksQuery, visibleCalendarIds]);

  // Scroll to 8am on first mount.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      y: DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR,
      animated: false,
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
            <View className="w-16 border-border border-r" />
            <View className="flex-1 flex-row">
              {visibleDays.map((day) => {
                const isTodayHighlight = isToday(day);
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
              <View className="w-16 border-border border-r" />
              <View className="flex-1 flex-row">
                {visibleDays.map((day) => {
                  const items = allDayEventsByDay.get(day.toString()) ?? [];
                  return (
                    <View
                      className="min-h-[38px] flex-1 gap-1 border-border border-r px-2 py-1.5"
                      key={`${day.toString()}-allday`}
                    >
                      {items.slice(0, 3).map((e) => {
                        const calendarColors = calendarColorLookup.get(
                          `${e.source.accountId}:${e.source.calendarId}`
                        );

                        return (
                          <AllDayEventChip
                            calendarColors={calendarColors}
                            item={e}
                            key={`${e.source.calendarId}-${e.source.event.id}`}
                            onPress={() => openEditAllDayEvent(e)}
                          />
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Scrollable time grid */}
          <ScrollView
            className="flex-1"
            ref={scrollRef}
            refreshControl={
              <RefreshControl
                onRefresh={refreshCalendarData}
                refreshing={
                  tasksQuery.isFetching ||
                  isFetchingGoogleEvents ||
                  isFetchingAccounts > 0 ||
                  isFetchingCalendars > 0
                }
                tintColor={isDarkColorScheme ? "#fafafa" : "#0a0a0a"}
              />
            }
          >
            <View className="flex-row">
              {/* Time gutter */}
              <View className="w-16 border-border border-r">
                {HOURS.map((hour) => (
                  <View
                    className="justify-start px-1.5 pt-0.5"
                    key={`gutter-${hour}`}
                    style={{ height: PIXELS_PER_HOUR }}
                  >
                    <Text className="text-[10px] text-muted-foreground">
                      {hour.toString().padStart(2, "0")}:00
                    </Text>
                  </View>
                ))}
              </View>

              {/* Day columns */}
              <View className="flex-1 flex-row">
                {visibleDays.map((day) => {
                  const dayKey = day.toString();
                  const dayEvents = timedEventsByDay.get(dayKey) ?? [];
                  const dayTasks = tasksByDay.get(dayKey) ?? [];
                  const isTodayColumn = isToday(day);
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
                        const eventId = `${evt.source.calendarId}-${evt.source.event.id}`;
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
                        const calendarColors = calendarColorLookup.get(
                          `${evt.source.accountId}:${evt.source.calendarId}`
                        );

                        return (
                          <TimedGoogleEventBlock
                            calendarColors={calendarColors}
                            columnIndex={layout?.columnIndex}
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
                        const columnIndex = layout?.columnIndex ?? 0;
                        const totalColumns = layout?.totalColumns ?? 1;
                        const zIndexValue = layout?.zIndex ?? 1;
                        const columnWidthPercent = 100 / totalColumns;
                        const leftPercent = columnIndex * columnWidthPercent;
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
                      {isTodayColumn ? <CurrentTimeIndicator /> : null}
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
          calendarOptions={calendarOptions}
          draft={eventDraft}
          isConferencePending={isConferencePending}
          isVisible
          locationSuggestions={locationSuggestions}
          mapsUrl={mapsUrl}
          meetingLink={meetingLink}
          onAddGoogleMeet={addGoogleMeetToEventDraft}
          onClose={closeEventModal}
          onCreate={saveEvent}
          onLocationSuggestionsOpenChange={setLocationSuggestionsOpen}
          setDraft={(updater) =>
            setEventDraft((current) =>
              current?.mode === "create" ? updater(current) : current
            )
          }
          showLocationSuggestions={showLocationSuggestions}
          timeZone={timeZone}
        />
      ) : null}

      {eventDraft?.mode === "edit" ? (
        <EditEventEditorSheet
          calendarOptions={calendarOptions}
          draft={eventDraft}
          isConferencePending={isConferencePending}
          isVisible
          locationSuggestions={locationSuggestions}
          mapsUrl={mapsUrl}
          meetingLink={meetingLink}
          onAddGoogleMeet={addGoogleMeetToEventDraft}
          onClose={closeEventModal}
          onDelete={deleteEvent}
          onLocationSuggestionsOpenChange={setLocationSuggestionsOpen}
          onSave={saveEvent}
          setDraft={(updater) =>
            setEventDraft((current) =>
              current && isEditEventDraft(current) ? updater(current) : current
            )
          }
          showLocationSuggestions={showLocationSuggestions}
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
        status={editingTask?.status ?? null}
        timeZone={timeZone}
      />
    </View>
  );
}
