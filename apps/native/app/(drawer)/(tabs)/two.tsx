import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Temporal } from "temporal-polyfill";
import { CalendarPickerModal } from "@/components/calendar/calendar-picker-modal";
import { Container } from "@/components/container";
import { useGoogleAccounts } from "@/hooks/use-google-accounts";
import { useGoogleCalendars } from "@/hooks/use-google-calendars";
import { useGoogleEvents } from "@/hooks/use-google-events";
import { useTasks } from "@/hooks/use-tasks";
import { useVisibleCalendars } from "@/hooks/use-visible-calendars";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";
import {
  type CalendarIdentifier,
  isCalendarVisible,
  type VisibleCalendars,
} from "@/lib/visible-calendars";
import { orpc } from "@/utils/orpc";

const PIXELS_PER_HOUR = 80;
const MINUTES_STEP = 15;
const DEFAULT_SCROLL_HOUR = 8;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

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

function buildEventWindow(center: Temporal.PlainDate, timeZone: string) {
  const paddingDays = 15;
  const monthStart = center.with({ day: 1 });
  const monthEnd = center.with({ day: center.daysInMonth });

  const start = monthStart
    .subtract({ days: paddingDays })
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") });

  const endExclusive = monthEnd
    .add({ days: paddingDays + 1 })
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") });

  return {
    timeMin: start.toInstant().toString(),
    timeMax: endExclusive.toInstant().toString(),
  };
}

function snapMinutes(mins: number): number {
  const snapped = Math.round(mins / MINUTES_STEP) * MINUTES_STEP;
  return Math.max(0, Math.min(24 * 60 - MINUTES_STEP, snapped));
}

function isoStringToZonedDateTime(str: string, timeZone: string) {
  // Google events usually return ISO strings with offset (or Z). Convert to local tz.
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
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
  mode: "create" | "edit";
  eventId?: string;
}

interface TaskDraft {
  title: string;
  description: string;
  durationMinutes: number;
  dueDate: Temporal.PlainDate | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
}

function buildDraftFromTask(task: TaskSelectDecoded): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    durationMinutes: task.durationMinutes,
    dueDate: task.dueDate,
    startDate: task.startDate,
    startTime: task.startTime,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: MVP screen kept in one file for iteration speed.
export default function CalendarTab() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const timeZone = getSystemTimeZone();
  const queryClient = useQueryClient();

  // 1–3 day view control.
  const [visibleDaysCount, setVisibleDaysCount] = useState<1 | 2 | 3>(3);
  const [currentDate, setCurrentDate] = useState<Temporal.PlainDate>(() =>
    todayPlainDate(timeZone)
  );

  const visibleDays = useMemo(
    () =>
      Array.from({ length: visibleDaysCount }, (_, i) =>
        currentDate.add({ days: i })
      ),
    [currentDate, visibleDaysCount]
  );

  const window = useMemo(
    () => buildEventWindow(currentDate, timeZone),
    [currentDate, timeZone]
  );

  // Tasks (for scheduled task blocks).
  const { tasksQuery, updateTask, deleteTask } = useTasks();
  const tasks = tasksQuery.data ?? [];

  const scheduledTasks = useMemo(
    () => tasks.filter((t) => t.startDate !== null && t.startTime !== null),
    [tasks]
  );

  // Google accounts/calendars/events.
  const googleAccountsQuery = useGoogleAccounts();
  const googleAccounts = googleAccountsQuery.data ?? [];
  const accountIds = useMemo(
    () => googleAccounts.map((a) => a.id),
    [googleAccounts]
  );

  const { calendars: googleCalendars } = useGoogleCalendars(accountIds);

  const { visibleCalendars, setVisibleCalendars } = useVisibleCalendars();
  const effectiveVisibleCalendars: VisibleCalendars = visibleCalendars ?? null;

  const visibleCalendarIds = useMemo<CalendarIdentifier[]>(() => {
    // Not signed in / no accounts → nothing visible.
    if (googleCalendars.length === 0) {
      return [];
    }
    // Default: show all calendars.
    if (effectiveVisibleCalendars === null) {
      return googleCalendars.map((c) => ({
        accountId: c.accountId,
        calendarId: c.calendar.id,
      }));
    }
    // Explicit selection.
    return effectiveVisibleCalendars;
  }, [effectiveVisibleCalendars, googleCalendars]);

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
      const startDate = item.event.start.date;
      const startDateTime = item.event.start.dateTime;
      const endDateTime = item.event.end.dateTime;

      // All-day: date-only with no datetime fields.
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
    // Only show toggled-visible calendars in the event creation modal.
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
  }, [visibleDaysCount]);

  const goToNext = useCallback(() => {
    setCurrentDate((d) => d.add({ days: visibleDaysCount }));
  }, [visibleDaysCount]);

  const goToToday = useCallback(() => {
    setCurrentDate(todayPlainDate(timeZone));
  }, [timeZone]);

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
      const start = combineDateTime(day, startTime, timeZone);
      const end = start.add({ minutes: 30 });
      setEventDraft({
        mode: "create",
        summary: "",
        description: "",
        location: "",
        calendar: {
          accountId: defaultCalendar.accountId,
          calendarId: defaultCalendar.calendarId,
        },
        start,
        end,
      });
    },
    [defaultCalendar, timeZone]
  );

  const openEditEvent = useCallback((item: PositionedGoogleEvent) => {
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
      start: item.start,
      end: item.end,
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

    const eventPayload = {
      summary: eventDraft.summary.trim(),
      description: eventDraft.description.trim() || undefined,
      location: eventDraft.location.trim() || undefined,
      start: { dateTime: eventDraft.start.toInstant().toString() },
      end: { dateTime: eventDraft.end.toInstant().toString() },
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

    // Refetch google events after a mutation (simple + reliable for v1).
    queryClient.invalidateQueries({ queryKey: ["google-events"] });
    closeEventModal();
  }, [closeEventModal, eventDraft, queryClient]);

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
    queryClient.invalidateQueries({ queryKey: ["google-events"] });
    closeEventModal();
  }, [closeEventModal, eventDraft, queryClient]);

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

  // Scroll to 8am on first mount for a sensible default.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      y: DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR,
      animated: false,
    });
  }, []);

  return (
    <Container>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={goToPrevious}
            style={[styles.navButton, { borderColor: theme.border }]}
          >
            <Text style={[styles.navButtonText, { color: theme.text }]}>
              {"<"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goToNext}
            style={[styles.navButton, { borderColor: theme.border }]}
          >
            <Text style={[styles.navButtonText, { color: theme.text }]}>
              {">"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goToToday}
            style={[styles.todayButton, { borderColor: theme.border }]}
          >
            <Text style={[styles.todayButtonText, { color: theme.text }]}>
              Today
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.daysToggle}>
            {[1, 2, 3].map((n) => (
              <TouchableOpacity
                key={n}
                onPress={() => setVisibleDaysCount(n as 1 | 2 | 3)}
                style={[
                  styles.daysToggleButton,
                  {
                    borderColor: theme.border,
                    backgroundColor:
                      visibleDaysCount === n ? theme.card : "transparent",
                  },
                ]}
              >
                <Text style={[styles.daysToggleText, { color: theme.text }]}>
                  {n}d
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => setIsPickerOpen(true)}
            style={[styles.pickerButton, { borderColor: theme.border }]}
          >
            <Text style={[styles.pickerButtonText, { color: theme.text }]}>
              Calendars
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Day headers + optional all-day row */}
      <View style={[styles.daysHeader, { borderColor: theme.border }]}>
        <View style={[styles.gutterHeader, { borderColor: theme.border }]} />
        <View style={styles.daysHeaderRow}>
          {visibleDays.map((day) => (
            <View
              key={day.toString()}
              style={[styles.dayHeaderCell, { borderColor: theme.border }]}
            >
              <Text style={[styles.dayHeaderText, { color: theme.text }]}>
                {day.toString()}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {hasAllDayEvents ? (
        <View style={[styles.allDayRow, { borderColor: theme.border }]}>
          <View style={[styles.gutterHeader, { borderColor: theme.border }]} />
          <View style={styles.daysHeaderRow}>
            {visibleDays.map((day) => {
              const items = allDayEventsByDay.get(day.toString()) ?? [];
              return (
                <View
                  key={`${day.toString()}-allday`}
                  style={[styles.allDayCell, { borderColor: theme.border }]}
                >
                  {items.slice(0, 3).map((e) => (
                    <Text
                      key={`${e.source.calendarId}-${e.source.event.id}`}
                      numberOfLines={1}
                      style={[
                        styles.allDayPill,
                        { color: theme.text, backgroundColor: theme.card },
                      ]}
                    >
                      {e.source.event.summary ?? "All-day"}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              tasksQuery.refetch();
              googleAccountsQuery.refetch();
              queryClient.invalidateQueries({ queryKey: ["google-calendars"] });
              queryClient.invalidateQueries({ queryKey: ["google-events"] });
            }}
            refreshing={
              tasksQuery.isFetching ||
              isFetchingGoogleEvents ||
              googleAccountsQuery.isFetching
            }
            tintColor={theme.text}
          />
        }
        style={styles.scroll}
      >
        <View style={styles.gridRow}>
          {/* Time gutter */}
          <View style={[styles.gutter, { borderColor: theme.border }]}>
            {HOURS.map((hour) => (
              <View
                key={`gutter-${hour}`}
                style={[styles.gutterHour, { height: PIXELS_PER_HOUR }]}
              >
                <Text
                  style={[
                    styles.gutterText,
                    { color: theme.text, opacity: 0.7 },
                  ]}
                >
                  {hour.toString().padStart(2, "0")}:00
                </Text>
              </View>
            ))}
          </View>

          {/* Day columns */}
          <View style={styles.columns}>
            {visibleDays.map((day) => {
              const dayKey = day.toString();
              const dayEvents = timedEventsByDay.get(dayKey) ?? [];
              const dayTasks = tasksByDay.get(dayKey) ?? [];

              return (
                <Pressable
                  key={dayKey}
                  onPress={(e) => {
                    // Translate tap position to time.
                    const y = e.nativeEvent.locationY;
                    const minutes = (y / PIXELS_PER_HOUR) * 60;
                    openCreateEventAt(day, minutes);
                  }}
                  style={[
                    styles.column,
                    { borderColor: theme.border, height: totalHeight },
                  ]}
                >
                  {/* Hour lines */}
                  {HOURS.map((hour) => (
                    <View
                      key={`${dayKey}-line-${hour}`}
                      style={[
                        styles.hourLine,
                        {
                          top: hour * PIXELS_PER_HOUR,
                          borderColor: theme.border,
                        },
                      ]}
                    />
                  ))}

                  {/* Google events */}
                  {dayEvents.map((evt) => {
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

                    return (
                      <Pressable
                        key={`${evt.source.calendarId}-${evt.source.event.id}-${evt.start.toString()}`}
                        onPress={(e) => {
                          e.stopPropagation();
                          openEditEvent(evt);
                        }}
                        style={[
                          styles.eventBlock,
                          {
                            top,
                            height,
                            backgroundColor: theme.primary,
                            borderColor: theme.primary,
                          },
                        ]}
                      >
                        <Text numberOfLines={2} style={styles.eventBlockText}>
                          {evt.source.event.summary ?? "Event"}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {/* Scheduled tasks */}
                  {dayTasks.map((task) => {
                    if (!(task.startDate && task.startTime)) {
                      return null;
                    }
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

                    return (
                      <Pressable
                        key={task.id}
                        onPress={(e) => {
                          e.stopPropagation();
                          openEditTask(task);
                        }}
                        style={[
                          styles.taskBlock,
                          {
                            top,
                            height,
                            backgroundColor: theme.card,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <Text
                          numberOfLines={2}
                          style={[styles.taskBlockText, { color: theme.text }]}
                        >
                          {task.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

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
        <View style={styles.modalBackdrop}>
          <View
            style={[styles.modalCard, { backgroundColor: theme.background }]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                {eventDraft?.mode === "edit" ? "Edit event" : "New event"}
              </Text>
              <TouchableOpacity onPress={closeEventModal}>
                <Text style={[styles.modalClose, { color: theme.text }]}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              onChangeText={(value) =>
                setEventDraft((d) => (d ? { ...d, summary: value } : d))
              }
              placeholder="Title"
              placeholderTextColor={theme.text}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border },
              ]}
              value={eventDraft?.summary ?? ""}
            />

            <TextInput
              onChangeText={(value) =>
                setEventDraft((d) => (d ? { ...d, location: value } : d))
              }
              placeholder="Location (optional)"
              placeholderTextColor={theme.text}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border },
              ]}
              value={eventDraft?.location ?? ""}
            />

            <TextInput
              multiline
              onChangeText={(value) =>
                setEventDraft((d) => (d ? { ...d, description: value } : d))
              }
              placeholder="Description (optional)"
              placeholderTextColor={theme.text}
              style={[
                styles.textArea,
                { color: theme.text, borderColor: theme.border },
              ]}
              value={eventDraft?.description ?? ""}
            />

            {/* Calendar selection (cycle through visible calendars) */}
            <TouchableOpacity
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
              style={[
                styles.secondaryButton,
                {
                  borderColor: theme.border,
                  opacity: calendarOptions.length === 0 ? 0.5 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
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
            </TouchableOpacity>

            {/* Start/end pickers */}
            <View style={styles.buttonsRow}>
              <TouchableOpacity
                onPress={() =>
                  setEventPicker({ kind: "startDate", mode: "date" })
                }
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  Start date: {eventDraft?.start.toPlainDate().toString()}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  setEventPicker({ kind: "startTime", mode: "time" })
                }
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  Start time:{" "}
                  {eventDraft?.start
                    .toPlainTime()
                    .toString({ smallestUnit: "minute" })}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.buttonsRow}>
              <TouchableOpacity
                onPress={() =>
                  setEventPicker({ kind: "endDate", mode: "date" })
                }
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  End date: {eventDraft?.end.toPlainDate().toString()}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  setEventPicker({ kind: "endTime", mode: "time" })
                }
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  End time:{" "}
                  {eventDraft?.end
                    .toPlainTime()
                    .toString({ smallestUnit: "minute" })}
                </Text>
              </TouchableOpacity>
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
                    const startDate = d.start.toPlainDate();
                    const startTime = d.start.toPlainTime();
                    const endDate = d.end.toPlainDate();
                    const endTime = d.end.toPlainTime();
                    const durationMinutes = Math.max(
                      MINUTES_STEP,
                      Math.round(
                        d.end.since(d.start).total({ unit: "minutes" })
                      )
                    );

                    if (eventPicker.kind === "startDate") {
                      const nextDate = dateToPlainDate(date, timeZone);
                      const nextStart = combineDateTime(
                        nextDate,
                        startTime,
                        timeZone
                      );
                      const nextEnd = nextStart.add({
                        minutes: durationMinutes,
                      });
                      return { ...d, start: nextStart, end: nextEnd };
                    }
                    if (eventPicker.kind === "startTime") {
                      const nextTime = dateToPlainTime(date, timeZone);
                      const nextStart = combineDateTime(
                        startDate,
                        nextTime,
                        timeZone
                      );
                      const nextEnd = nextStart.add({
                        minutes: durationMinutes,
                      });
                      return { ...d, start: nextStart, end: nextEnd };
                    }
                    if (eventPicker.kind === "endDate") {
                      const nextDate = dateToPlainDate(date, timeZone);
                      const nextEnd = combineDateTime(
                        nextDate,
                        endTime,
                        timeZone
                      );
                      return { ...d, end: nextEnd };
                    }
                    if (eventPicker.kind === "endTime") {
                      const nextTime = dateToPlainTime(date, timeZone);
                      const nextEnd = combineDateTime(
                        endDate,
                        nextTime,
                        timeZone
                      );
                      return { ...d, end: nextEnd };
                    }
                    return d;
                  });
                  setEventPicker(null);
                }}
                value={(() => {
                  const value =
                    eventPicker.kind === "endDate" ||
                    eventPicker.kind === "endTime"
                      ? eventDraft.end
                      : eventDraft.start;
                  return new Date(value.toInstant().toString());
                })()}
              />
            ) : null}

            <View style={styles.modalFooter}>
              {eventDraft?.mode === "edit" ? (
                <TouchableOpacity
                  onPress={deleteEvent}
                  style={[
                    styles.dangerButton,
                    { borderColor: theme.notification },
                  ]}
                >
                  <Text
                    style={[
                      styles.dangerButtonText,
                      { color: theme.notification },
                    ]}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={saveEvent}
                style={[
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                ]}
              >
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit scheduled task modal (basic) */}
      <Modal
        animationType="slide"
        onRequestClose={closeTaskModal}
        transparent
        visible={editingTask !== null && taskDraft !== null}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[styles.modalCard, { backgroundColor: theme.background }]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                Edit task
              </Text>
              <TouchableOpacity onPress={closeTaskModal}>
                <Text style={[styles.modalClose, { color: theme.text }]}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              onChangeText={(value) =>
                setTaskDraft((d) => (d ? { ...d, title: value } : d))
              }
              placeholder="Title"
              placeholderTextColor={theme.text}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border },
              ]}
              value={taskDraft?.title ?? ""}
            />

            <View style={styles.buttonsRow}>
              <TouchableOpacity
                onPress={() =>
                  setTaskPicker({ kind: "startDate", mode: "date" })
                }
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  Start date:{" "}
                  {taskDraft?.startDate
                    ? taskDraft.startDate.toString()
                    : "none"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!taskDraft?.startDate}
                onPress={() =>
                  setTaskPicker({ kind: "startTime", mode: "time" })
                }
                style={[
                  styles.secondaryButton,
                  {
                    borderColor: theme.border,
                    opacity: taskDraft?.startDate ? 1 : 0.5,
                  },
                ]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  Start time:{" "}
                  {taskDraft?.startTime
                    ? taskDraft.startTime.toString({ smallestUnit: "minute" })
                    : "none"}
                </Text>
              </TouchableOpacity>
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
                  // Default picker value:
                  // - if we already have a startDate/time, use it
                  // - otherwise use "now"
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

            <View style={styles.modalFooter}>
              <TouchableOpacity
                onPress={deleteTaskFromCalendar}
                style={[
                  styles.dangerButton,
                  { borderColor: theme.notification },
                ]}
              >
                <Text
                  style={[
                    styles.dangerButtonText,
                    { color: theme.notification },
                  ]}
                >
                  Delete
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveTask}
                style={[
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                ]}
              >
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Container>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  navButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  navButtonText: {
    fontWeight: "800",
  },
  todayButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  todayButtonText: {
    fontWeight: "700",
  },
  daysToggle: {
    flexDirection: "row",
  },
  daysToggleButton: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  daysToggleText: {
    fontWeight: "700",
  },
  pickerButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pickerButtonText: {
    fontWeight: "700",
  },

  daysHeader: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  gutterHeader: {
    width: 64,
    borderRightWidth: 1,
  },
  daysHeaderRow: {
    flex: 1,
    flexDirection: "row",
  },
  dayHeaderCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRightWidth: 1,
  },
  dayHeaderText: {
    fontWeight: "700",
    fontSize: 12,
  },
  allDayRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  allDayCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: 1,
    minHeight: 38,
    gap: 4,
  },
  allDayPill: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 11,
  },

  scroll: {
    flex: 1,
  },
  gridRow: {
    flexDirection: "row",
  },
  gutter: {
    width: 64,
    borderRightWidth: 1,
  },
  gutterHour: {
    justifyContent: "flex-start",
    paddingTop: 2,
    paddingHorizontal: 6,
  },
  gutterText: {
    fontSize: 10,
  },
  columns: {
    flex: 1,
    flexDirection: "row",
  },
  column: {
    flex: 1,
    borderRightWidth: 1,
    position: "relative",
  },
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
  },
  eventBlock: {
    position: "absolute",
    left: 6,
    right: 6,
    borderWidth: 1,
    padding: 6,
  },
  eventBlockText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
  },
  taskBlock: {
    position: "absolute",
    left: 6,
    right: 6,
    borderWidth: 1,
    padding: 6,
  },
  taskBlockText: {
    fontWeight: "700",
    fontSize: 12,
  },

  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalCard: {
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  modalClose: {
    fontSize: 14,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  textArea: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    fontSize: 14,
    minHeight: 88,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  modalFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  dangerButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  dangerButtonText: {
    fontWeight: "700",
  },
  primaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
