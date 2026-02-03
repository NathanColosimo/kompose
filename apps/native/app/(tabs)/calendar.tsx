import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  type CalendarIdentifier,
  isCalendarVisible,
} from "@kompose/state/atoms/visible-calendars";
import { useGoogleAccounts } from "@kompose/state/hooks/use-google-accounts";
import { useGoogleCalendars } from "@kompose/state/hooks/use-google-calendars";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useVisibleCalendars } from "@kompose/state/hooks/use-visible-calendars";
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
  View,
} from "react-native";
import { Temporal } from "temporal-polyfill";
import { CalendarPickerModal } from "@/components/calendar/calendar-picker-modal";
import { Container } from "@/components/container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { useColorScheme } from "@/lib/color-scheme-context";
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

export default function CalendarTab() {
  const { isDarkColorScheme } = useColorScheme();
  const timeZone = getSystemTimeZone();
  const queryClient = useQueryClient();

  // 1-3 day view control.
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

  const {
    visibleCalendars,
    setVisibleCalendars,
    setVisibleCalendarsAll,
  } = useVisibleCalendars();

  const visibleCalendarIds = visibleCalendars;

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
    const visible = googleCalendars.filter((c) =>
      isCalendarVisible(visibleCalendars, c.accountId, c.calendar.id)
    );
    return visible.map((c) => ({
      accountId: c.accountId,
      calendarId: c.calendar.id,
      label: c.calendar.summary ?? "Calendar",
    }));
  }, [visibleCalendars, googleCalendars]);

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
    googleAccountsQuery.refetch();

    // Only refresh visible calendars and the active window to avoid broad invalidation.
    for (const accountId of accountIds) {
      queryClient.invalidateQueries({
        queryKey: ["google-calendars", accountId],
      });
    }
    for (const calendar of visibleCalendarIds) {
      queryClient.invalidateQueries({
        queryKey: getEventsQueryKey(calendar),
      });
    }
  }, [
    accountIds,
    getEventsQueryKey,
    googleAccountsQuery,
    queryClient,
    tasksQuery,
    visibleCalendarIds,
  ]);

  // Scroll to 8am on first mount.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      y: DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR,
      animated: false,
    });
  }, []);

  return (
    <Container>
      {/* Header */}
      <View className="flex-row items-center justify-between gap-3 px-4 pt-3 pb-2">
        <View className="flex-row items-center gap-2">
          <Button onPress={goToPrevious} size="sm" variant="outline">
            <Text>{"<"}</Text>
          </Button>
          <Button onPress={goToNext} size="sm" variant="outline">
            <Text>{">"}</Text>
          </Button>
          <Button onPress={goToToday} size="sm" variant="outline">
            <Text>Today</Text>
          </Button>
        </View>

        <View className="flex-row items-center gap-2">
          <View className="flex-row">
            {[1, 2, 3].map((n) => (
              <Button
                className={visibleDaysCount === n ? "bg-card" : undefined}
                key={n}
                onPress={() => setVisibleDaysCount(n as 1 | 2 | 3)}
                size="sm"
                variant="outline"
              >
                <Text>{n}d</Text>
              </Button>
            ))}
          </View>
          <Button
            onPress={() => setIsPickerOpen(true)}
            size="sm"
            variant="outline"
          >
            <Text>Calendars</Text>
          </Button>
        </View>
      </View>

      {/* Day headers */}
      <View className="flex-row border-border border-t border-b">
        <View className="w-16 border-border border-r" />
        <View className="flex-1 flex-row">
          {visibleDays.map((day) => (
            <View
              className="flex-1 border-border border-r px-2 py-2"
              key={day.toString()}
            >
              <Text className="font-bold text-foreground text-xs">
                {day.toString()}
              </Text>
            </View>
          ))}
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
                  {items.slice(0, 3).map((e) => (
                    <Text
                      className="bg-card px-1.5 py-1 text-[11px] text-foreground"
                      key={`${e.source.calendarId}-${e.source.event.id}`}
                      numberOfLines={1}
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
              googleAccountsQuery.isFetching
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
                        className="absolute right-1.5 left-1.5 border border-primary bg-primary p-1.5"
                        key={`${evt.source.calendarId}-${evt.source.event.id}-${evt.start.toString()}`}
                        onPress={(e) => {
                          e.stopPropagation();
                          openEditEvent(evt);
                        }}
                        style={{ top, height }}
                      >
                        <Text
                          className="font-bold text-primary-foreground text-xs"
                          numberOfLines={2}
                        >
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
                        className="absolute right-1.5 left-1.5 border border-border bg-card p-1.5"
                        key={task.id}
                        onPress={(e) => {
                          e.stopPropagation();
                          openEditTask(task);
                        }}
                        style={{ top, height }}
                      >
                        <Text
                          className="font-bold text-foreground text-xs"
                          numberOfLines={2}
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
        setVisibleCalendarsAll={setVisibleCalendarsAll}
        visibleCalendars={visibleCalendars}
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

            {/* Start/end pickers */}
            <View className="mb-2.5 flex-row gap-2">
              <Button
                onPress={() =>
                  setEventPicker({ kind: "startDate", mode: "date" })
                }
                variant="outline"
              >
                <Text>
                  Start date: {eventDraft?.start.toPlainDate().toString()}
                </Text>
              </Button>
              <Button
                onPress={() =>
                  setEventPicker({ kind: "startTime", mode: "time" })
                }
                variant="outline"
              >
                <Text>
                  Start time:{" "}
                  {eventDraft?.start
                    .toPlainTime()
                    .toString({ smallestUnit: "minute" })}
                </Text>
              </Button>
            </View>

            <View className="mb-2.5 flex-row gap-2">
              <Button
                onPress={() =>
                  setEventPicker({ kind: "endDate", mode: "date" })
                }
                variant="outline"
              >
                <Text>
                  End date: {eventDraft?.end.toPlainDate().toString()}
                </Text>
              </Button>
              <Button
                onPress={() =>
                  setEventPicker({ kind: "endTime", mode: "time" })
                }
                variant="outline"
              >
                <Text>
                  End time:{" "}
                  {eventDraft?.end
                    .toPlainTime()
                    .toString({ smallestUnit: "minute" })}
                </Text>
              </Button>
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
