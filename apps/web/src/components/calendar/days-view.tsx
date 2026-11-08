"use client";

import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  getGoogleEventEditBlockReason,
  isGoogleEventEditable,
} from "@kompose/google-cal/schema";
import {
  currentDateAtom,
  timezoneAtom,
} from "@kompose/state/atoms/current-date";
import {
  normalizedGoogleColorsAtomFamily,
  resolveGoogleEventColors,
} from "@kompose/state/atoms/google-colors";
import {
  type GoogleEventWithSource,
  googleCalendarsDataAtom,
} from "@kompose/state/atoms/google-data";
import {
  shouldShowWhoopRow,
  whoopAccountIdAtom,
  whoopSummariesByDayAtom,
} from "@kompose/state/atoms/whoop-data";
import {
  calculateCollisionLayout,
  type ItemLayout,
  type PositionedItem,
} from "@kompose/state/collision-utils";
import { startOfDayZoned } from "@kompose/state/temporal-utils";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Temporal } from "temporal-polyfill";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  clampZonedDateTime,
  getDayBoundsZoned,
  isoStringToZonedDateTime,
  minutesFromMidnight,
  zonedDateTimeToDate,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import {
  CREATE_EVENT_REQUEST_TTL_MS,
  createEventRequestedAtom,
  scrollToNowRequestedAtom,
} from "@/state/calendar-navigation";
import { effectiveVisibleDaysAtom } from "@/state/sidebar";
import { PIXELS_PER_HOUR } from "./constants";
import { CreationPreview } from "./event-creation/creation-preview";
import { EventCreationPopover } from "./event-creation/event-creation-popover";
import {
  EventCreationContext,
  useEventCreation,
  useEventCreationState,
} from "./event-creation/use-event-creation";
import { eventColor } from "./events/block-content";
import { EventEditPopover } from "./events/event-edit-popover";
import { GoogleCalendarEvent } from "./events/google-event";
import { TaskEvent } from "./events/task-event";
import { WhoopSleepBand } from "./events/whoop-sleep-band";
import { WhoopWorkoutEvent } from "./events/whoop-workout-event";
import { DayColumn } from "./time-grid/day-column";
import { DayHeader } from "./time-grid/day-header";
import { TimeGutter } from "./time-grid/time-gutter";

/** Default scroll position on mount (7am), to show mornings' sleep and workouts. */
const DEFAULT_SCROLL_HOUR = 7;
/** Pixels above the default hour line, enough to show its whole label. */
const HOUR_LABEL_CLEARANCE = 12;
const MAX_ALL_DAY_EVENTS = 2;
const EMPTY_GOOGLE_EVENTS: GoogleEventWithSource[] = [];

type PositionedGoogleEvent = GoogleEventWithSource & {
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
};

type ScheduledTask = TaskSelectDecoded & {
  startDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime;
};

interface PositionedTaskSegment {
  end: Temporal.ZonedDateTime;
  isFirstSegment: boolean;
  isLastSegment: boolean;
  start: Temporal.ZonedDateTime;
  task: ScheduledTask;
}

type AllDayGoogleEvent = GoogleEventWithSource & { date: Temporal.PlainDate };

/**
 * Start and end, in minutes from midnight, of an item's part on one day. An
 * end at midnight is the day's end (1440), as on a middle day of a
 * multi-day event, which runs midnight to midnight.
 */
function dayPartMinutes(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime
): { endMinutes: number; startMinutes: number } {
  const startMinutes = minutesFromMidnight(start);
  const endMinutes = minutesFromMidnight(end);
  return {
    endMinutes:
      endMinutes === 0 && Temporal.ZonedDateTime.compare(end, start) > 0
        ? 1440
        : endMinutes,
    startMinutes,
  };
}

/**
 * Clamp a positioned event to a single day's boundaries (midnight to midnight).
 * Returns null if the event doesn't overlap the given day.
 */
function clampEventToDay(
  event: PositionedGoogleEvent,
  day: Temporal.PlainDate,
  timeZone: string
): PositionedGoogleEvent | null {
  const { dayStart, dayEnd } = getDayBoundsZoned(day, timeZone);

  if (
    Temporal.ZonedDateTime.compare(event.end, dayStart) <= 0 ||
    Temporal.ZonedDateTime.compare(event.start, dayEnd) >= 0
  ) {
    return null;
  }

  return {
    ...event,
    end: clampZonedDateTime(event.end, dayStart, dayEnd),
    start: clampZonedDateTime(event.start, dayStart, dayEnd),
  };
}

/** The date of an all-day event (one with a `date` and no `dateTime`), else null. */
function allDayEventDate({
  event,
}: GoogleEventWithSource): Temporal.PlainDate | null {
  if (!event.start.date || event.start.dateTime || event.end.dateTime) {
    return null;
  }
  return Temporal.PlainDate.from(event.start.date);
}

/** The event's part on each of `days` it touches; an overnight event splits at midnight. */
function daySegments(
  event: PositionedGoogleEvent,
  days: Temporal.PlainDate[],
  timeZone: string
): PositionedGoogleEvent[] {
  if (event.start.toPlainDate().equals(event.end.toPlainDate())) {
    return [event];
  }
  return days.flatMap((day) => clampEventToDay(event, day, timeZone) ?? []);
}

/** Buckets events by day key; events on days outside `days` are dropped. */
function buildGoogleEventMaps({
  days,
  googleEvents,
  timeZone,
}: {
  days: Temporal.PlainDate[];
  googleEvents: GoogleEventWithSource[];
  timeZone: string;
}): {
  timedEventsByDay: Map<string, PositionedGoogleEvent[]>;
  allDayEventsByDay: Map<string, AllDayGoogleEvent[]>;
} {
  const timed = new Map<string, PositionedGoogleEvent[]>();
  const allDay = new Map<string, AllDayGoogleEvent[]>();
  for (const day of days) {
    timed.set(day.toString(), []);
    allDay.set(day.toString(), []);
  }

  for (const sourceEvent of googleEvents) {
    const date = allDayEventDate(sourceEvent);
    if (date) {
      // All-day end dates are exclusive; a trip from the 11th to the 13th
      // shows on the 11th and 12th.
      const endDate = sourceEvent.event.end.date
        ? Temporal.PlainDate.from(sourceEvent.event.end.date)
        : date.add({ days: 1 });
      for (const day of days) {
        if (
          Temporal.PlainDate.compare(day, date) >= 0 &&
          Temporal.PlainDate.compare(day, endDate) < 0
        ) {
          allDay.get(day.toString())?.push({ ...sourceEvent, date });
        }
      }
      continue;
    }
    const positioned = toPositionedGoogleEvent(sourceEvent, timeZone);
    if (!positioned) {
      continue;
    }
    for (const segment of daySegments(positioned, days, timeZone)) {
      timed.get(segment.start.toPlainDate().toString())?.push(segment);
    }
  }

  return { allDayEventsByDay: allDay, timedEventsByDay: timed };
}

function toPositionedGoogleEvent(
  sourceEvent: GoogleEventWithSource,
  timeZone: string
): PositionedGoogleEvent | null {
  const startStr =
    sourceEvent.event.start.dateTime ?? sourceEvent.event.start.date;
  const endStr = sourceEvent.event.end.dateTime ?? sourceEvent.event.end.date;

  if (!(startStr && endStr)) {
    return null;
  }

  try {
    const start = isoStringToZonedDateTime(startStr, timeZone);
    const end = isoStringToZonedDateTime(endStr, timeZone);
    return { ...sourceEvent, end, start };
  } catch {
    return null;
  }
}

/**
 * Where "c" creates: the next half hour today, or 9 AM tomorrow once today
 * has no half hour left; when today isn't shown, 9 AM on the first visible
 * day. Never in the past.
 */
function keyboardCreateStart(
  visibleDays: Temporal.PlainDate[],
  timeZone: string
): Temporal.ZonedDateTime {
  const now = Temporal.Now.zonedDateTimeISO(timeZone);
  const today = now.toPlainDate();
  const isVisible = (day: Temporal.PlainDate) =>
    visibleDays.some((visible) => visible.equals(day));
  const at = (day: Temporal.PlainDate, minutes: number) =>
    day.toZonedDateTime({
      plainTime: Temporal.PlainTime.from({
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      }),
      timeZone,
    });
  const nextHalfHour = Math.ceil((now.hour * 60 + now.minute) / 30) * 30;
  if (isVisible(today) && nextHalfHour < 24 * 60) {
    return at(today, nextHalfHour);
  }
  // Today is over: tomorrow at 9 AM, even if the view has to move there.
  if (isVisible(today)) {
    return at(today.add({ days: 1 }), 9 * 60);
  }
  return at(visibleDays[0] ?? today, 9 * 60);
}

/** A short name for the zone on `day`, such as "EST" or "GMT+1". */
function timeZoneLabel(timeZone: string, day: Temporal.PlainDate): string {
  const noon = day.toZonedDateTime({ plainTime: "12:00", timeZone });
  return (
    new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "short" })
      .formatToParts(noon.epochMilliseconds)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

function isScheduledTask(task: TaskSelectDecoded): task is ScheduledTask {
  return task.startDate !== null && task.startTime !== null;
}

/**
 * Whether `task` could touch a day from `first` to `last`, using cheap date
 * math: wall-clock days, widened by one so DST shifts can't hide a day. It
 * may keep a task that doesn't touch the range (`clampTaskToDay` decides),
 * but never drops one that does.
 */
function mayTouchDays(
  task: ScheduledTask,
  first: Temporal.PlainDate,
  last: Temporal.PlainDate
): boolean {
  if (Temporal.PlainDate.compare(task.startDate, last) > 0) {
    return false;
  }
  const startMinutes = task.startTime.hour * 60 + task.startTime.minute;
  const spanDays =
    Math.floor((startMinutes + task.durationMinutes) / (24 * 60)) + 1;
  return (
    Temporal.PlainDate.compare(task.startDate.add({ days: spanDays }), first) >=
    0
  );
}

function clampTaskToDay(
  task: ScheduledTask,
  day: Temporal.PlainDate,
  timeZone: string
): PositionedTaskSegment | null {
  const start = task.startDate.toZonedDateTime({
    plainTime: task.startTime,
    timeZone,
  });
  const end = start.add({ minutes: task.durationMinutes });
  const { dayStart, dayEnd } = getDayBoundsZoned(day, timeZone);

  if (
    Temporal.ZonedDateTime.compare(end, dayStart) <= 0 ||
    Temporal.ZonedDateTime.compare(start, dayEnd) >= 0
  ) {
    return null;
  }

  const clampedStart = clampZonedDateTime(start, dayStart, dayEnd);
  const clampedEnd = clampZonedDateTime(end, dayStart, dayEnd);

  return {
    end: clampedEnd,
    isFirstSegment: Temporal.ZonedDateTime.compare(clampedStart, start) === 0,
    isLastSegment: Temporal.ZonedDateTime.compare(clampedEnd, end) === 0,
    start: clampedStart,
    task,
  };
}

interface DaysViewProps {
  /** Google events (raw from API) to render separately from tasks */
  googleEvents?: GoogleEventWithSource[];
  /** All tasks to display (will be filtered to scheduled ones) */
  tasks: TaskSelectDecoded[];
}

/**
 * DaysView - Displays 1-7 days starting from the current date.
 * Provides the event creation context for click-and-drag event creation.
 */
export const DaysView = memo(function DaysViewComponent({
  tasks,
  googleEvents = EMPTY_GOOGLE_EVENTS,
}: DaysViewProps) {
  const eventCreation = useEventCreationState();
  return (
    <EventCreationContext.Provider value={eventCreation}>
      <DaysViewInner googleEvents={googleEvents} tasks={tasks} />
    </EventCreationContext.Provider>
  );
});

/**
 * Inner component that has access to EventCreationContext.
 */
const DaysViewInner = memo(function DaysViewInnerComponent({
  tasks,
  googleEvents = EMPTY_GOOGLE_EVENTS,
}: DaysViewProps) {
  const visibleDays = useAtomValue(effectiveVisibleDaysAtom);
  const whoopSummaries = useAtomValue(whoopSummariesByDayAtom);
  const timeZone = useAtomValue(timezoneAtom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollToNowRequested, setScrollToNowRequested] = useAtom(
    scrollToNowRequestedAtom
  );
  const headerContainerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(49);

  // Event creation context for click-and-drag
  const { actions } = useEventCreation();

  // Scroll vertically to 7am on mount for a sensible default view. Hour
  // labels sit centered on their line, so stop a little above it to show
  // the whole "7 AM" label.
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop =
        DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR - HOUR_LABEL_CLEARANCE;
    }
  }, []);

  useLayoutEffect(() => {
    const grid = scrollRef.current;
    if (!(grid && scrollToNowRequested)) {
      return;
    }
    const now = Temporal.Now.zonedDateTimeISO(timeZone);
    const position = (now.hour + now.minute / 60) * PIXELS_PER_HOUR;
    // Instant for both the toolbar and keyboard; keep time visible near the center.
    grid.scrollTop = Math.max(0, position - grid.clientHeight / 2);
    setScrollToNowRequested(false);
  }, [scrollToNowRequested, setScrollToNowRequested, timeZone]);

  // Keyboard and command-bar path to a new event; slots are mouse-only.
  const [createEventRequested, setCreateEventRequested] = useAtom(
    createEventRequestedAtom
  );
  const setCurrentDate = useSetAtom(currentDateAtom);
  useLayoutEffect(() => {
    const grid = scrollRef.current;
    const firstDay = visibleDays[0];
    if (!(grid && createEventRequested !== null && firstDay)) {
      return;
    }
    // One left waiting (calendars never loaded) can't open an editor on
    // some later visit.
    if (Date.now() - createEventRequested > CREATE_EVENT_REQUEST_TTL_MS) {
      setCreateEventRequested(null);
      return;
    }
    const start = keyboardCreateStart(visibleDays, timeZone);
    const startDay = start.toPlainDate();
    if (!visibleDays.some((day) => day.equals(startDay))) {
      // Show that day first; the request stays and runs once it's visible.
      setCurrentDate(startDay);
      return;
    }
    const result = actions.createAt(start);
    if (result === "waiting") {
      // Opened from another page: the calendars are still loading. The
      // request stays and runs again once they have.
      return;
    }
    setCreateEventRequested(null);
    grid.scrollTop = Math.max(
      0,
      (start.hour + start.minute / 60) * PIXELS_PER_HOUR - grid.clientHeight / 3
    );
  }, [
    actions,
    createEventRequested,
    setCreateEventRequested,
    setCurrentDate,
    timeZone,
    visibleDays,
  ]);

  // Track header height (dates + all-day row) to align the gutter corner
  useLayoutEffect(() => {
    const node = headerContainerRef.current;
    if (!node) {
      return;
    }

    const measure = () => setHeaderHeight(node.offsetHeight || 49);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Every scheduled task in the list (all history, plus recurring occurrences)
  // would otherwise go through time-zone math for each visible day.
  const nearbyScheduledTasks = useMemo(() => {
    const first = visibleDays[0];
    const last = visibleDays.at(-1);
    if (!(first && last)) {
      return [];
    }
    return tasks.filter(
      (task): task is ScheduledTask =>
        isScheduledTask(task) && mayTouchDays(task, first, last)
    );
  }, [tasks, visibleDays]);

  // Split scheduled tasks into per-day display segments so tasks that cross
  // midnight render in each touched day without overflowing the grid.
  const taskSegmentsByDay = useMemo(() => {
    const grouped = new Map<string, PositionedTaskSegment[]>();

    for (const day of visibleDays) {
      grouped.set(
        day.toString(),
        nearbyScheduledTasks.flatMap((task) => {
          const segment = clampTaskToDay(task, day, timeZone);
          return segment ? [segment] : [];
        })
      );
    }

    return grouped;
  }, [visibleDays, nearbyScheduledTasks, timeZone]);

  // Group Google events by day (timed vs all-day) and keep them separate from tasks
  const { timedEventsByDay, allDayEventsByDay } = useMemo(
    () =>
      buildGoogleEventMaps({
        days: visibleDays,
        googleEvents,
        timeZone,
      }),
    [visibleDays, googleEvents, timeZone]
  );

  const hasGoogleEvents = googleEvents.length > 0;
  const firstDay = visibleDays[0];
  const zoneLabel = useMemo(
    () => (firstDay ? timeZoneLabel(timeZone, firstDay) : ""),
    [timeZone, firstDay]
  );
  const whoopAccountId = useAtomValue(whoopAccountIdAtom);
  const showWhoopRow = shouldShowWhoopRow(
    whoopAccountId,
    visibleDays.map((day) => day.toString()),
    whoopSummaries
  );

  // Collect all sleep blocks across visible WHOOP summaries so each
  // day column can render bands for sleeps that cross midnight.
  // WhoopSleepBand handles overlap/clamp per column internally.
  const allSleepBlocks = useMemo(() => {
    const blocks: {
      id: string;
      isNap: boolean;
      start: string;
      end: string;
      totalSleepMilliseconds: number;
    }[] = [];
    for (const summary of whoopSummaries.values()) {
      if (summary.sleep) {
        blocks.push({
          end: summary.sleep.end,
          id: summary.sleep.id,
          isNap: false,
          start: summary.sleep.start,
          totalSleepMilliseconds: summary.sleep.totalSleepMilliseconds,
        });
      }
      for (const nap of summary.naps) {
        blocks.push({
          end: nap.end,
          id: nap.id,
          isNap: true,
          start: nap.start,
          totalSleepMilliseconds: nap.totalSleepMilliseconds,
        });
      }
    }
    return blocks;
  }, [whoopSummaries]);

  // Collect all workouts across visible summaries so late-night workouts
  // that cross midnight can render in both the start and end day columns.
  const allWorkouts = useMemo(() => {
    const workouts: {
      id: string;
      sportName: string | null;
      strainScore: number | null;
      start: string;
      end: string;
    }[] = [];
    for (const summary of whoopSummaries.values()) {
      for (const workout of summary.workouts) {
        workouts.push({
          end: workout.end,
          id: workout.id,
          sportName: workout.sportName,
          start: workout.start,
          strainScore: workout.strainScore,
        });
      }
    }
    return workouts;
  }, [whoopSummaries]);

  // Calculate collision layouts for all visible days
  // Combines tasks, google events, and whoop workouts into unified collision groups
  const collisionLayoutsByDay = useMemo(() => {
    const layoutsByDay = new Map<string, Map<string, ItemLayout>>();

    for (const day of visibleDays) {
      const dayKey = day.toString();
      const dayTaskSegments = taskSegmentsByDay.get(dayKey) ?? [];
      const dayGoogleEvents = timedEventsByDay.get(dayKey) ?? [];

      // Convert task segments to PositionedItems. Segments are already
      // clamped to day boundaries, matching the rendered task blocks.
      const taskItems: PositionedItem[] = dayTaskSegments.map((segment) => ({
        ...dayPartMinutes(segment.start, segment.end),
        id: `task-${segment.task.id}`,
        type: "task" as const,
      }));

      // Convert google events to PositionedItems.
      // Events are already clamped to day boundaries by buildGoogleEventMaps.
      const googleItems: PositionedItem[] = dayGoogleEvents.map((ge) => {
        const { endMinutes, startMinutes } = dayPartMinutes(ge.start, ge.end);
        return {
          endMinutes:
            endMinutes > startMinutes ? endMinutes : startMinutes + 30,
          id: `google-${ge.accountId}-${ge.calendarId}-${ge.event.id}`,
          startMinutes,
          type: "google-event" as const,
        };
      });

      // Convert WHOOP workouts to PositionedItems, clamped to this day.
      // Uses allWorkouts (collected from all summaries) so workouts that
      // cross midnight appear in both day columns.
      const { dayStart, dayEnd } = getDayBoundsZoned(day, timeZone);

      const { compare } = Temporal.ZonedDateTime;
      const whoopItems: PositionedItem[] = allWorkouts.flatMap((workout) => {
        const wStart = isoStringToZonedDateTime(workout.start, timeZone);
        const wEnd = isoStringToZonedDateTime(workout.end, timeZone);
        if (compare(wEnd, dayStart) <= 0 || compare(wStart, dayEnd) >= 0) {
          return [];
        }
        const clampedStart = clampZonedDateTime(wStart, dayStart, dayEnd);
        const clampedEnd = clampZonedDateTime(wEnd, dayStart, dayEnd);
        const { endMinutes, startMinutes } = dayPartMinutes(
          clampedStart,
          clampedEnd
        );
        return {
          endMinutes: Math.max(endMinutes, startMinutes + 15),
          id: `whoop-workout-${workout.id}`,
          startMinutes,
          type: "whoop-workout" as const,
        };
      });

      // Calculate layout for all items on this day
      const allItems = [...taskItems, ...googleItems, ...whoopItems];
      // Blocks are at least 20px tall, a 15-minute slot (event-position.ts).
      const layout = calculateCollisionLayout(allItems, {
        minDrawnMinutes: 15,
      });
      layoutsByDay.set(dayKey, layout);
    }

    return layoutsByDay;
  }, [visibleDays, taskSegmentsByDay, timedEventsByDay, allWorkouts, timeZone]);

  // Each day column width as percentage of the parent container
  const dayColumnWidth = `${100 / visibleDays.length}%`;

  return (
    <div className="flex h-full">
      {/* Fixed time gutter column */}
      <div className="flex w-16 shrink-0 flex-col border-r bg-background">
        {/* Corner above the gutter: the time zone, and a label for the
            all-day row. Its height matches the header block. */}
        <div
          className="flex shrink-0 flex-col border-b text-[10px] text-muted-foreground"
          style={{ height: headerHeight }}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-end pr-2",
              showWhoopRow ? "h-[3.75rem]" : "h-12"
            )}
            title={timeZone}
          >
            {zoneLabel}
          </span>
          {/* The all-day row always shows, so paging doesn't move the grid. */}
          <span className="flex flex-1 items-start justify-end border-t pt-1.5 pr-2">
            All day
          </span>
        </div>
        {/* Time gutter - scrolls vertically with the body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <TimeGutterSynced scrollRef={scrollRef} />
        </div>
      </div>

      {/* Main area with vertical scrolling only */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header row */}
        <div
          className="sticky top-0 z-10 shrink-0 overflow-hidden border-b bg-background"
          ref={(node) => {
            headerContainerRef.current = node;
          }}
        >
          <div className="flex flex-col" style={{ width: "100%" }}>
            <div className="flex">
              {visibleDays.map((day) => {
                const dayKey = day.toString();
                return (
                  <DayHeader
                    date={day}
                    key={dayKey}
                    showWhoopRow={showWhoopRow}
                    whoopSummary={whoopSummaries.get(dayKey)}
                    width={dayColumnWidth}
                  />
                );
              })}
            </div>

            <div className="flex border-border border-t bg-background/80">
              {visibleDays.map((day) => {
                const dayKey = day.toString();
                const dayAllDay = allDayEventsByDay.get(dayKey) ?? [];

                return (
                  <div
                    className="flex min-h-7 flex-col items-start gap-1 overflow-hidden border-border border-r px-2 py-1 last:border-r-0"
                    key={`${dayKey}-all-day`}
                    style={{ width: dayColumnWidth }}
                  >
                    {dayAllDay
                      .slice(0, MAX_ALL_DAY_EVENTS)
                      .map((item: AllDayGoogleEvent) => (
                        <AllDayEventChip
                          item={item}
                          key={`${item.accountId}-${item.calendarId}-${item.event.id}`}
                          timeZone={timeZone}
                        />
                      ))}
                    {dayAllDay.length > MAX_ALL_DAY_EVENTS ? (
                      <AllDayOverflow
                        day={day}
                        items={dayAllDay}
                        timeZone={timeZone}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Scrollable day columns - vertical only */}
        <div
          className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden"
          ref={scrollRef}
        >
          <div className="flex w-full">
            {visibleDays.map((day) => {
              const dayKey = day.toString();
              const dayTaskSegments = taskSegmentsByDay.get(dayKey) ?? [];
              const dayGoogleEvents = timedEventsByDay.get(dayKey) ?? [];
              const dayLayouts = collisionLayoutsByDay.get(dayKey);

              return (
                <DayColumn
                  date={day}
                  key={dayKey}
                  onSlotDragMove={actions.onSlotDragMove}
                  onSlotHover={actions.onSlotHover}
                  onSlotLeave={actions.onSlotLeave}
                  onSlotMouseDown={actions.onSlotMouseDown}
                  onSlotMouseUp={actions.onSlotMouseUp}
                  overlay={<CreationPreview columnDate={day} />}
                  timeZone={timeZone}
                  width={dayColumnWidth}
                >
                  {/* WHOOP sleep background bands — check all summaries
                      since sleep blocks often cross midnight into an
                      adjacent day that doesn't "own" the sleep cycle. */}
                  {allSleepBlocks.map((sleep) => (
                    <WhoopSleepBand
                      columnDate={day}
                      end={sleep.end}
                      isNap={sleep.isNap}
                      key={sleep.id}
                      start={sleep.start}
                      timeZone={timeZone}
                      totalSleepMilliseconds={sleep.totalSleepMilliseconds}
                    />
                  ))}
                  {/* One list in start order (the layout's z order), so
                      Tab moves through the day's events and tasks in time
                      order. WHOOP workouts come from all collected workouts
                      so cross-midnight ones appear in both day columns. */}
                  {[
                    ...(hasGoogleEvents
                      ? dayGoogleEvents.map(
                          ({
                            event,
                            start,
                            end,
                            calendarId,
                            accountId,
                          }: PositionedGoogleEvent) => {
                            const layoutKey = `google-${accountId}-${calendarId}-${event.id}`;
                            const layout = dayLayouts?.get(layoutKey);
                            return {
                              node: (
                                <GoogleCalendarEvent
                                  accountId={accountId}
                                  calendarId={calendarId}
                                  end={end}
                                  event={event}
                                  // Keyed by identity, not times: a time change keeps the
                                  // block (and an open editor's draft) mounted.
                                  key={layoutKey}
                                  layout={layout}
                                  start={start}
                                />
                              ),
                              order: layout?.zIndex ?? 0,
                            };
                          }
                        )
                      : []),
                    ...dayTaskSegments.map((segment) => {
                      const layoutKey = `task-${segment.task.id}`;
                      const layout = dayLayouts?.get(layoutKey);
                      return {
                        node: (
                          <TaskEvent
                            isFirstSegment={segment.isFirstSegment}
                            isLastSegment={segment.isLastSegment}
                            key={layoutKey}
                            layout={layout}
                            segmentEnd={segment.end}
                            segmentStart={segment.start}
                            task={segment.task}
                          />
                        ),
                        order: layout?.zIndex ?? 0,
                      };
                    }),
                    ...allWorkouts.flatMap((workout) => {
                      const layout = dayLayouts?.get(
                        `whoop-workout-${workout.id}`
                      );
                      if (!layout) {
                        return [];
                      }
                      return [
                        {
                          node: (
                            <WhoopWorkoutEvent
                              columnDate={day}
                              end={workout.end}
                              id={workout.id}
                              key={workout.id}
                              layout={layout}
                              sportName={workout.sportName}
                              start={workout.start}
                              strainScore={workout.strainScore}
                              timeZone={timeZone}
                            />
                          ),
                          order: layout.zIndex,
                        },
                      ];
                    }),
                  ]
                    .sort((a, b) => a.order - b.order)
                    .map(({ node }) => node)}
                </DayColumn>
              );
            })}
          </div>
        </div>

        {/* Event creation popover - shows after click-and-drag */}
        <EventCreationPopover />
      </div>
    </div>
  );
});

/**
 * TimeGutterSynced - Time gutter that syncs its vertical scroll with the main scroll area.
 */
function TimeGutterSynced({
  scrollRef,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);

  // Sync vertical scroll position with main scroll area
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      if (gutterRef.current) {
        gutterRef.current.scrollTop = scrollContainer.scrollTop;
      }
    };

    handleScroll();
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  return (
    <div className="h-full overflow-hidden" ref={gutterRef}>
      <TimeGutter />
    </div>
  );
}

DaysView.displayName = "DaysView";

/** "+N more" for a day's all-day row: opens the day's full list. */
function AllDayOverflow({
  day,
  items,
  timeZone,
}: {
  day: Temporal.PlainDate;
  items: AllDayGoogleEvent[];
  timeZone: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="rounded-sm px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          type="button"
        >
          +{items.length - MAX_ALL_DAY_EVENTS} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1.5 p-2">
        <p className="px-1 font-medium text-muted-foreground text-xs">
          {day.toLocaleString(undefined, {
            day: "numeric",
            month: "long",
            weekday: "long",
          })}
        </p>
        {items.map((item) => (
          <AllDayEventChip
            item={item}
            key={`${item.accountId}-${item.calendarId}-${item.event.id}`}
            timeZone={timeZone}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function AllDayEventChip({
  item,
  timeZone,
}: {
  item: AllDayGoogleEvent;
  timeZone: string;
}) {
  const normalizedPalette = useAtomValue(
    normalizedGoogleColorsAtomFamily(item.accountId)
  );
  const calendars = useAtomValue(googleCalendarsDataAtom);

  const calendar = calendars.find(
    (c) => c.accountId === item.accountId && c.calendar.id === item.calendarId
  );

  const { background: backgroundColor } = resolveGoogleEventColors({
    calendarBackgroundColor: calendar?.calendar.backgroundColor,
    calendarForegroundColor: calendar?.calendar.foregroundColor,
    colorId: item.event.colorId,
    palette: normalizedPalette?.event,
  });

  // The whole event's dates, not the drawn day, so opening a multi-day
  // event from a later day can't save it shorter.
  const startDate = item.event.start.date
    ? Temporal.PlainDate.from(item.event.start.date)
    : item.date;
  const endDate = item.event.end.date
    ? Temporal.PlainDate.from(item.event.end.date)
    : startDate.add({ days: 1 });
  const startZdt = startOfDayZoned(startDate, timeZone);
  const endZdt = startOfDayZoned(endDate, timeZone);

  return (
    <EventEditPopover
      accountId={item.accountId}
      calendarId={item.calendarId}
      end={zonedDateTimeToDate(endZdt)}
      event={item.event}
      readOnly={
        !isGoogleEventEditable(item.event, calendar?.calendar.accessRole)
      }
      readOnlyReason={getGoogleEventEditBlockReason(
        item.event,
        calendar?.calendar.accessRole
      )}
      start={zonedDateTimeToDate(startZdt)}
    >
      <button
        className="event-surface block w-full max-w-full truncate rounded-[4px] py-0.5 pr-1.5 pl-2 text-left font-medium text-[11px] leading-4"
        style={eventColor(backgroundColor)}
        title={item.event.summary || "(No title)"}
        type="button"
      >
        {item.event.summary || "(No title)"}
      </button>
    </EventEditPopover>
  );
}
