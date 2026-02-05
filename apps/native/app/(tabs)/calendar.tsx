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
import { useTasks } from "@kompose/state/hooks/use-tasks";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Temporal } from "temporal-polyfill";
import { CalendarPickerModal } from "@/components/calendar/calendar-picker-modal";
import { Container } from "@/components/container";
import { TagPicker } from "@/components/tags/tag-picker";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
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
const EVENT_BLOCK_INSET_PX = 4;

// --- Temporal helpers ---

function todayPlainDate(timeZone: string): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

function dateToPlainDate(date: Date, timeZone: string): Temporal.PlainDate {
  const zdt = Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(
    timeZone
  );
  return zdt.toPlainDate();
}

function dateToPlainTime(date: Date, timeZone: string): Temporal.PlainTime {
  const zdt = Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(
    timeZone
  );
  return Temporal.PlainTime.from({
    hour: zdt.hour,
    minute: zdt.minute,
    second: 0,
  });
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

interface EventDraft {
  summary: string;
  description: string;
  location: string;
  calendar: CalendarIdentifier;
  allDay: boolean;
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime | null;
  endTime: Temporal.PlainTime | null;
  mode: "create" | "edit";
  eventId?: string;
}

interface TaskDraft {
  title: string;
  description: string;
  tagIds: string[];
  durationMinutes: number;
  dueDate: Temporal.PlainDate | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
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
      className="rounded border px-1.5 py-1"
      onPress={onPress}
      style={{ backgroundColor: background, borderColor: background }}
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
      className="absolute rounded-md border p-1 shadow-black/5 shadow-sm"
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={{
        top,
        height,
        left: `${leftPercent}%`,
        width: `${columnWidthPercent}%`,
        paddingHorizontal: 4,
        zIndex,
        backgroundColor: background,
        borderColor: background,
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
  const [eventPicker, setEventPicker] = useState<
    | { kind: "startDate"; mode: "date" }
    | { kind: "startTime"; mode: "time" }
    | { kind: "endDate"; mode: "date" }
    | { kind: "endTime"; mode: "time" }
    | null
  >(null);

  // Edit scheduled task modal state.
  const [editingTask, setEditingTask] = useState<TaskSelectDecoded | null>(
    null
  );
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [taskPicker, setTaskPicker] = useState<
    | { kind: "startDate"; mode: "date" }
    | { kind: "startTime"; mode: "time" }
    | null
  >(null);

  const calendarOptions = useMemo(() => {
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
      setEventDraft({
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
      });
    },
    [defaultCalendar]
  );

  const openEditTimedEvent = useCallback((item: PositionedGoogleEvent) => {
    setEventDraft({
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
    });
  }, []);

  const openEditAllDayEvent = useCallback((item: AllDayGoogleEvent) => {
    // Google all-day events use exclusive end date, so we need to parse it carefully.
    const endDateStr = item.source.event.end.date;
    const endDate = endDateStr
      ? Temporal.PlainDate.from(endDateStr).subtract({ days: 1 })
      : item.date;

    setEventDraft({
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
      startDate: item.date,
      endDate,
      startTime: null,
      endTime: null,
    });
  }, []);

  const closeEventModal = useCallback(() => {
    setEventPicker(null);
    setEventDraft(null);
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
      start: startPayload,
      end: endPayload,
    };

    if (eventDraft.mode === "create") {
      await orpc.googleCal.events.create.call({
        accountId: eventDraft.calendar.accountId,
        calendarId: eventDraft.calendar.calendarId,
        event: eventPayload,
      });
    } else if (eventDraft.mode === "edit" && eventDraft.eventId) {
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
    if (!(eventDraft && eventDraft.mode === "edit" && eventDraft.eventId)) {
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
    setTaskPicker(null);
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
    <Container>
      <GestureDetector gesture={swipeGesture}>
        <View className="flex-1">
          {/* Header - pillbox style */}
          <View className="flex-row items-center justify-between px-3 pt-3 pb-2">
            {/* Left group: visibility toggle + day count */}
            <View className="flex-row items-center rounded-lg border border-border bg-card">
              <Pressable
                accessibilityLabel="Select visible calendars"
                className="items-center justify-center rounded-l-lg px-3 py-2 active:bg-muted"
                onPress={() => setIsPickerOpen(true)}
              >
                <Icon as={Eye} className="text-foreground" size={16} />
              </Pressable>
              <View className="h-6 w-px bg-border" />
              {[1, 2, 3].map((n, idx) => (
                <Pressable
                  className={`items-center justify-center px-3 py-2 active:bg-muted ${n === 3 ? "rounded-r-lg" : ""} ${visibleDaysCount === n ? "bg-muted" : ""}`}
                  key={n}
                  onPress={() => setVisibleDaysCount(n)}
                >
                  <Text
                    className={`text-sm ${visibleDaysCount === n ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    {n}d
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Right group: today + navigation */}
            <View className="flex-row items-center rounded-lg border border-border bg-card">
              <Pressable
                accessibilityLabel="Go to today"
                className="items-center justify-center rounded-l-lg px-3 py-2 active:bg-muted"
                onPress={goToToday}
              >
                <Text className="font-medium text-foreground text-sm">
                  Today
                </Text>
              </Pressable>
              <View className="h-6 w-px bg-border" />
              <Pressable
                accessibilityLabel="Previous days"
                className="items-center justify-center px-2.5 py-2 active:bg-muted"
                onPress={goToPrevious}
              >
                <Icon as={ChevronLeft} className="text-foreground" size={18} />
              </Pressable>
              <Pressable
                accessibilityLabel="Next days"
                className="items-center justify-center rounded-r-lg px-2.5 py-2 active:bg-muted"
                onPress={goToNext}
              >
                <Icon as={ChevronRight} className="text-foreground" size={18} />
              </Pressable>
            </View>
          </View>

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
                            className="absolute rounded-md border border-primary/40 bg-primary/90 p-1 shadow-black/5 shadow-sm"
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
                              paddingHorizontal: 4,
                              zIndex: zIndexValue,
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

      {/* Create/Edit Google event modal */}
      <Modal
        animationType="slide"
        onRequestClose={closeEventModal}
        transparent
        visible={eventDraft !== null}
      >
        <View className="flex-1 justify-end bg-black/35">
          <View className="rounded-t-2xl bg-background p-4">
            {/* Modal header */}
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="font-bold text-foreground text-lg">
                {eventDraft?.mode === "edit" ? "Edit event" : "New event"}
              </Text>
              <Button onPress={closeEventModal} size="sm" variant="ghost">
                <Text>Close</Text>
              </Button>
            </View>

            <Input
              className="mb-3"
              onChangeText={(value) =>
                setEventDraft((d) => (d ? { ...d, summary: value } : d))
              }
              placeholder="Title"
              value={eventDraft?.summary ?? ""}
            />

            <Input
              className="mb-3"
              onChangeText={(value) =>
                setEventDraft((d) => (d ? { ...d, location: value } : d))
              }
              placeholder="Location (optional)"
              value={eventDraft?.location ?? ""}
            />

            <Textarea
              className="mb-3"
              onChangeText={(value) =>
                setEventDraft((d) => (d ? { ...d, description: value } : d))
              }
              placeholder="Description (optional)"
              value={eventDraft?.description ?? ""}
            />

            {/* Calendar selection */}
            <Button
              className="mb-2.5"
              disabled={calendarOptions.length === 0}
              onPress={() => {
                setEventDraft((d) => {
                  if (!d) {
                    return d;
                  }
                  const idx = calendarOptions.findIndex(
                    (c) =>
                      c.accountId === d.calendar.accountId &&
                      c.calendarId === d.calendar.calendarId
                  );
                  const next =
                    calendarOptions[(idx + 1) % calendarOptions.length];
                  if (!next) {
                    return d;
                  }
                  return {
                    ...d,
                    calendar: {
                      accountId: next.accountId,
                      calendarId: next.calendarId,
                    },
                  };
                });
              }}
              variant="outline"
            >
              <Text>
                Calendar: {(() => {
                  const current = eventDraft?.calendar;
                  const match = calendarOptions.find(
                    (c) =>
                      c.accountId === current?.accountId &&
                      c.calendarId === current?.calendarId
                  );
                  return match?.label ?? "Select calendars first";
                })()}
              </Text>
            </Button>

            {/* All-day toggle */}
            <Pressable
              className="mb-2.5 flex-row items-center gap-2"
              onPress={() =>
                setEventDraft((d) => (d ? { ...d, allDay: !d.allDay } : d))
              }
            >
              <View
                className={`size-5 items-center justify-center rounded border ${eventDraft?.allDay ? "border-primary bg-primary" : "border-muted-foreground/50"}`}
              >
                {eventDraft?.allDay ? (
                  <Text className="font-bold text-primary-foreground text-xs">
                    ✓
                  </Text>
                ) : null}
              </View>
              <Text className="text-foreground text-sm">All day</Text>
            </Pressable>

            {/* Start date/time pickers */}
            <View className="mb-2.5 flex-row gap-2">
              <Button
                className="flex-1"
                onPress={() =>
                  setEventPicker({ kind: "startDate", mode: "date" })
                }
                variant="outline"
              >
                <Text>Start: {eventDraft?.startDate.toString()}</Text>
              </Button>
              {eventDraft?.allDay ? null : (
                <Button
                  onPress={() =>
                    setEventPicker({ kind: "startTime", mode: "time" })
                  }
                  variant="outline"
                >
                  <Text>
                    {eventDraft?.startTime?.toString({
                      smallestUnit: "minute",
                    }) ?? "09:00"}
                  </Text>
                </Button>
              )}
            </View>

            {/* End date/time pickers */}
            <View className="mb-2.5 flex-row gap-2">
              <Button
                className="flex-1"
                onPress={() =>
                  setEventPicker({ kind: "endDate", mode: "date" })
                }
                variant="outline"
              >
                <Text>End: {eventDraft?.endDate.toString()}</Text>
              </Button>
              {eventDraft?.allDay ? null : (
                <Button
                  onPress={() =>
                    setEventPicker({ kind: "endTime", mode: "time" })
                  }
                  variant="outline"
                >
                  <Text>
                    {eventDraft?.endTime?.toString({
                      smallestUnit: "minute",
                    }) ?? "10:00"}
                  </Text>
                </Button>
              )}
            </View>

            {eventPicker && eventDraft ? (
              <DateTimePicker
                mode={eventPicker.mode}
                onChange={(event: DateTimePickerEvent, date?: Date) => {
                  if (event.type === "dismissed") {
                    setEventPicker(null);
                    return;
                  }
                  if (!date) {
                    setEventPicker(null);
                    return;
                  }

                  setEventDraft((d) => {
                    if (!d) {
                      return d;
                    }

                    if (eventPicker.kind === "startDate") {
                      const nextDate = dateToPlainDate(date, timeZone);
                      // Keep end date at least equal to start date.
                      const nextEndDate =
                        Temporal.PlainDate.compare(nextDate, d.endDate) > 0
                          ? nextDate
                          : d.endDate;
                      return {
                        ...d,
                        startDate: nextDate,
                        endDate: nextEndDate,
                      };
                    }
                    if (eventPicker.kind === "startTime") {
                      const nextTime = dateToPlainTime(date, timeZone);
                      // Shift end time to maintain 30-minute duration.
                      const nextEndTime = nextTime.add({ minutes: 30 });
                      return {
                        ...d,
                        startTime: nextTime,
                        endTime: nextEndTime,
                      };
                    }
                    if (eventPicker.kind === "endDate") {
                      const nextDate = dateToPlainDate(date, timeZone);
                      return { ...d, endDate: nextDate };
                    }
                    if (eventPicker.kind === "endTime") {
                      const nextTime = dateToPlainTime(date, timeZone);
                      return { ...d, endTime: nextTime };
                    }
                    return d;
                  });
                  setEventPicker(null);
                }}
                value={(() => {
                  const defaultTime = Temporal.PlainTime.from("09:00");
                  if (eventPicker.kind === "startDate") {
                    const zdt = combineDateTime(
                      eventDraft.startDate,
                      eventDraft.startTime ?? defaultTime,
                      timeZone
                    );
                    return new Date(zdt.toInstant().toString());
                  }
                  if (eventPicker.kind === "startTime") {
                    const zdt = combineDateTime(
                      eventDraft.startDate,
                      eventDraft.startTime ?? defaultTime,
                      timeZone
                    );
                    return new Date(zdt.toInstant().toString());
                  }
                  if (eventPicker.kind === "endDate") {
                    const zdt = combineDateTime(
                      eventDraft.endDate,
                      eventDraft.endTime ?? defaultTime,
                      timeZone
                    );
                    return new Date(zdt.toInstant().toString());
                  }
                  if (eventPicker.kind === "endTime") {
                    const zdt = combineDateTime(
                      eventDraft.endDate,
                      eventDraft.endTime ?? defaultTime,
                      timeZone
                    );
                    return new Date(zdt.toInstant().toString());
                  }
                  return new Date();
                })()}
              />
            ) : null}

            {/* Modal footer */}
            <View className="mt-2 flex-row items-center justify-end gap-2.5">
              {eventDraft?.mode === "edit" ? (
                <Button onPress={deleteEvent} variant="destructive">
                  <Text>Delete</Text>
                </Button>
              ) : null}

              <Button onPress={saveEvent}>
                <Text>Save</Text>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit scheduled task modal */}
      <Modal
        animationType="slide"
        onRequestClose={closeTaskModal}
        transparent
        visible={editingTask !== null && taskDraft !== null}
      >
        <View className="flex-1 justify-end bg-black/35">
          <View className="rounded-t-2xl bg-background p-4">
            {/* Modal header */}
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="font-bold text-foreground text-lg">
                Edit task
              </Text>
              <Button onPress={closeTaskModal} size="sm" variant="ghost">
                <Text>Close</Text>
              </Button>
            </View>

            <Input
              className="mb-3"
              onChangeText={(value) =>
                setTaskDraft((d) => (d ? { ...d, title: value } : d))
              }
              placeholder="Title"
              value={taskDraft?.title ?? ""}
            />

            <View className="mb-3">
              <Text className="mb-2 font-semibold text-foreground text-sm">
                Tags
              </Text>
              <TagPicker
                onChange={(next) =>
                  setTaskDraft((d) => (d ? { ...d, tagIds: next } : d))
                }
                value={taskDraft?.tagIds ?? []}
              />
            </View>

            <View className="mb-2.5 flex-row gap-2">
              <Button
                onPress={() =>
                  setTaskPicker({ kind: "startDate", mode: "date" })
                }
                variant="outline"
              >
                <Text>
                  Start date:{" "}
                  {taskDraft?.startDate
                    ? taskDraft.startDate.toString()
                    : "none"}
                </Text>
              </Button>
              <Button
                disabled={!taskDraft?.startDate}
                onPress={() =>
                  setTaskPicker({ kind: "startTime", mode: "time" })
                }
                variant="outline"
              >
                <Text>
                  Start time:{" "}
                  {taskDraft?.startTime
                    ? taskDraft.startTime.toString({ smallestUnit: "minute" })
                    : "none"}
                </Text>
              </Button>
            </View>

            {taskPicker && taskDraft ? (
              <DateTimePicker
                mode={taskPicker.mode}
                onChange={(event: DateTimePickerEvent, date?: Date) => {
                  if (event.type === "dismissed") {
                    setTaskPicker(null);
                    return;
                  }
                  if (!date) {
                    setTaskPicker(null);
                    return;
                  }
                  if (taskPicker.kind === "startDate") {
                    setTaskDraft((d) =>
                      d
                        ? {
                            ...d,
                            startDate: dateToPlainDate(date, timeZone),
                          }
                        : d
                    );
                  }
                  if (taskPicker.kind === "startTime") {
                    setTaskDraft((d) =>
                      d
                        ? {
                            ...d,
                            startTime: dateToPlainTime(date, timeZone),
                          }
                        : d
                    );
                  }
                  setTaskPicker(null);
                }}
                value={(() => {
                  if (taskPicker.kind === "startDate") {
                    const date =
                      taskDraft.startDate ?? todayPlainDate(timeZone);
                    const time =
                      taskDraft.startTime ?? Temporal.PlainTime.from("09:00");
                    return new Date(
                      combineDateTime(date, time, timeZone)
                        .toInstant()
                        .toString()
                    );
                  }
                  if (taskPicker.kind === "startTime") {
                    const date =
                      taskDraft.startDate ?? todayPlainDate(timeZone);
                    const time =
                      taskDraft.startTime ?? Temporal.PlainTime.from("09:00");
                    return new Date(
                      combineDateTime(date, time, timeZone)
                        .toInstant()
                        .toString()
                    );
                  }
                  return new Date();
                })()}
              />
            ) : null}

            {/* Modal footer */}
            <View className="mt-2 flex-row items-center justify-end gap-2.5">
              <Button onPress={deleteTaskFromCalendar} variant="destructive">
                <Text>Delete</Text>
              </Button>
              <Button onPress={saveTask}>
                <Text>Save</Text>
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </Container>
  );
}
