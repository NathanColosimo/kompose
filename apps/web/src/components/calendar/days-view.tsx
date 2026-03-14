"use client";

import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  timezoneAtom,
  visibleDaysAtom,
} from "@kompose/state/atoms/current-date";
import {
  normalizedGoogleColorsAtomFamily,
  resolveGoogleEventColors,
} from "@kompose/state/atoms/google-colors";
import {
  type GoogleEventWithSource,
  googleCalendarsDataAtom,
} from "@kompose/state/atoms/google-data";
import { whoopSummariesByDayAtom } from "@kompose/state/atoms/whoop-data";
import {
  calculateCollisionLayout,
  type ItemLayout,
  type PositionedItem,
} from "@kompose/state/collision-utils";
import { useAtomValue } from "jotai";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Temporal } from "temporal-polyfill";
import {
  isoStringToZonedDateTime,
  isToday,
  minutesFromMidnight,
  zonedDateTimeToDate,
} from "@/lib/temporal-utils";
import { PIXELS_PER_HOUR } from "./constants";
import { CreationPreview } from "./event-creation/creation-preview";
import { EventCreationPopover } from "./event-creation/event-creation-popover";
import { EventCreationProvider } from "./event-creation/event-creation-provider";
import { useEventCreation } from "./event-creation/use-event-creation";
import { EventEditPopover } from "./events/event-edit-popover";
import { GoogleCalendarEvent } from "./events/google-event";
import { TaskEvent } from "./events/task-event";
import { WhoopSleepBand } from "./events/whoop-sleep-band";
import { WhoopWorkoutEvent } from "./events/whoop-workout-event";
import { DayColumn } from "./time-grid/day-column";
import { DayHeader } from "./time-grid/day-header";
import { TimeGutter } from "./time-grid/time-gutter";

/** Default scroll position on mount (8am) */
const DEFAULT_SCROLL_HOUR = 8;
const MAX_ALL_DAY_EVENTS = 2;

type PositionedGoogleEvent = GoogleEventWithSource & {
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
};

type AllDayGoogleEvent = GoogleEventWithSource & { date: Temporal.PlainDate };

function parseDateOnlyLocal(dateStr: string): Temporal.PlainDate {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!(year && month && day)) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  return Temporal.PlainDate.from({ year, month, day });
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
  const dayStart = day.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
  const dayEnd = dayStart.add({ days: 1 });

  if (
    Temporal.ZonedDateTime.compare(event.end, dayStart) <= 0 ||
    Temporal.ZonedDateTime.compare(event.start, dayEnd) >= 0
  ) {
    return null;
  }

  const clampedStart =
    Temporal.ZonedDateTime.compare(event.start, dayStart) < 0
      ? dayStart
      : event.start;
  const clampedEnd =
    Temporal.ZonedDateTime.compare(event.end, dayEnd) > 0 ? dayEnd : event.end;

  return { ...event, start: clampedStart, end: clampedEnd };
}

function buildGoogleEventMaps({
  bufferedDays,
  googleEvents,
  timeZone,
}: {
  bufferedDays: Temporal.PlainDate[];
  googleEvents: GoogleEventWithSource[];
  timeZone: string;
}): {
  timedEventsByDay: Map<string, PositionedGoogleEvent[]>;
  allDayEventsByDay: Map<string, AllDayGoogleEvent[]>;
} {
  const timed = new Map<string, PositionedGoogleEvent[]>();
  const allDay = new Map<string, AllDayGoogleEvent[]>();

  for (const day of bufferedDays) {
    const key = day.toString();
    timed.set(key, []);
    allDay.set(key, []);
  }

  for (const sourceEvent of googleEvents) {
    const startDate = sourceEvent.event.start.date;
    const hasStartDateTime = sourceEvent.event.start.dateTime;
    const hasEndDateTime = sourceEvent.event.end.dateTime;

    if (startDate && !hasStartDateTime && !hasEndDateTime) {
      const parsed = parseDateOnlyLocal(startDate);
      const key = parsed.toString();
      const bucket = allDay.get(key);
      if (bucket) {
        bucket.push({ ...sourceEvent, date: parsed });
      }
      continue;
    }

    const positioned = toPositionedGoogleEvent(sourceEvent, timeZone);
    if (!positioned) {
      continue;
    }

    const startDay = positioned.start.toPlainDate();
    const endDay = positioned.end.toPlainDate();
    if (startDay.equals(endDay)) {
      const dayEvents = timed.get(startDay.toString());
      if (dayEvents) {
        dayEvents.push(positioned);
      }
    } else {
      // Split overnight event into one segment per day it touches
      for (const day of bufferedDays) {
        const clamped = clampEventToDay(positioned, day, timeZone);
        if (clamped) {
          const bucket = timed.get(day.toString());
          if (bucket) {
            bucket.push(clamped);
          }
        }
      }
    }
  }

  return { timedEventsByDay: timed, allDayEventsByDay: allDay };
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
    return { ...sourceEvent, start, end };
  } catch {
    return null;
  }
}

interface DaysViewProps {
  /** Google events (raw from API) to render separately from tasks */
  googleEvents?: GoogleEventWithSource[];
  /** All tasks to display (will be filtered to scheduled ones) */
  tasks: TaskSelectDecoded[];
  /** Optional externally clamped day slice for responsive layouts */
  visibleDays?: Temporal.PlainDate[];
}

/**
 * DaysView - Displays 1-7 days starting from the current date.
 * Wrapped with EventCreationProvider to enable click-and-drag event creation.
 */
export const DaysView = memo(function DaysViewComponent({
  tasks,
  googleEvents = [],
  visibleDays,
}: DaysViewProps) {
  return (
    <EventCreationProvider>
      <DaysViewInner
        googleEvents={googleEvents}
        tasks={tasks}
        visibleDays={visibleDays}
      />
    </EventCreationProvider>
  );
});

/**
 * Inner component that has access to EventCreationContext.
 */
const DaysViewInner = memo(function DaysViewInnerComponent({
  tasks,
  googleEvents = [],
  visibleDays: visibleDaysProp,
}: DaysViewProps) {
  const atomVisibleDays = useAtomValue(visibleDaysAtom);
  const visibleDays = visibleDaysProp ?? atomVisibleDays;
  const whoopSummaries = useAtomValue(whoopSummariesByDayAtom);
  const timeZone = useAtomValue(timezoneAtom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerContainerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(49);

  // Event creation context for click-and-drag
  const { actions } = useEventCreation();

  // Memoize handlers to avoid recreating on each render
  const handleSlotHover = useCallback(
    (dateTime: Temporal.ZonedDateTime) => {
      actions.onSlotHover(dateTime);
    },
    [actions]
  );

  const handleSlotLeave = useCallback(() => {
    actions.onSlotLeave();
  }, [actions]);

  const handleSlotMouseDown = useCallback(
    (dateTime: Temporal.ZonedDateTime) => {
      actions.onSlotMouseDown(dateTime);
    },
    [actions]
  );

  const handleSlotDragMove = useCallback(
    (dateTime: Temporal.ZonedDateTime) => {
      actions.onSlotDragMove(dateTime);
    },
    [actions]
  );

  const handleSlotMouseUp = useCallback(() => {
    actions.onSlotMouseUp();
  }, [actions]);

  // Scroll vertically to 8am on mount for a sensible default view
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * PIXELS_PER_HOUR;
    }
  }, []);

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

  // Filter to only tasks that have both startDate AND startTime (scheduled tasks)
  const scheduledTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.startDate !== null && task.startTime !== null
      ),
    [tasks]
  );

  // Group scheduled tasks by start day. Tasks crossing midnight stay on
  // their start day only — the collision layout clamps endMinutes to 1440
  // and the visual overflow past the grid bottom is minimal.
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, TaskSelectDecoded[]>();

    for (const day of visibleDays) {
      grouped.set(day.toString(), []);
    }

    for (const task of scheduledTasks) {
      if (!task.startDate) {
        continue;
      }
      const dayKey = task.startDate.toString();
      const bucket = grouped.get(dayKey);
      if (bucket) {
        bucket.push(task);
      }
    }

    return grouped;
  }, [visibleDays, scheduledTasks]);

  // Group Google events by day (timed vs all-day) and keep them separate from tasks
  const { timedEventsByDay, allDayEventsByDay } = useMemo(
    () =>
      buildGoogleEventMaps({
        bufferedDays: visibleDays,
        googleEvents,
        timeZone,
      }),
    [visibleDays, googleEvents, timeZone]
  );

  const hasAllDayEvents = useMemo(
    () =>
      Array.from(allDayEventsByDay.values()).some(
        (eventsForDay) => eventsForDay.length > 0
      ),
    [allDayEventsByDay]
  );

  const hasGoogleEvents = googleEvents.length > 0;

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
          id: summary.sleep.id,
          isNap: false,
          start: summary.sleep.start,
          end: summary.sleep.end,
          totalSleepMilliseconds: summary.sleep.totalSleepMilliseconds,
        });
      }
      for (const nap of summary.naps) {
        blocks.push({
          id: nap.id,
          isNap: true,
          start: nap.start,
          end: nap.end,
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
          id: workout.id,
          sportName: workout.sportName,
          strainScore: workout.strainScore,
          start: workout.start,
          end: workout.end,
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
      const dayTasks = tasksByDay.get(dayKey) ?? [];
      const dayGoogleEvents = timedEventsByDay.get(dayKey) ?? [];

      // Convert tasks to PositionedItems. Tasks stay on their start day;
      // endMinutes is clamped to 1440 (midnight) for collision layout.
      const taskItems: PositionedItem[] = dayTasks
        .filter(
          (
            task
          ): task is typeof task & {
            startDate: NonNullable<typeof task.startDate>;
            startTime: NonNullable<typeof task.startTime>;
          } => task.startDate !== null && task.startTime !== null
        )
        .map((task) => {
          const startZdt = task.startDate.toZonedDateTime({
            timeZone,
            plainTime: task.startTime,
          });
          const startMinutes = minutesFromMidnight(startZdt);
          const endMinutes = Math.min(
            startMinutes + (task.durationMinutes ?? 30),
            1440
          );
          return {
            id: `task-${task.id}`,
            type: "task" as const,
            startMinutes,
            endMinutes,
          };
        });

      // Convert google events to PositionedItems.
      // Events are already clamped to day boundaries by buildGoogleEventMaps,
      // so endMinutes=0 means the event extends to midnight (1440).
      const googleItems: PositionedItem[] = dayGoogleEvents.map((ge) => {
        const startMinutes = minutesFromMidnight(ge.start);
        const rawEndMinutes = minutesFromMidnight(ge.end);
        const endMinutes =
          rawEndMinutes === 0 && startMinutes > 0 ? 1440 : rawEndMinutes;
        return {
          id: `google-${ge.accountId}-${ge.calendarId}-${ge.event.id}`,
          type: "google-event" as const,
          startMinutes,
          endMinutes:
            endMinutes > startMinutes ? endMinutes : startMinutes + 30,
        };
      });

      // Convert WHOOP workouts to PositionedItems, clamped to this day.
      // Uses allWorkouts (collected from all summaries) so workouts that
      // cross midnight appear in both day columns.
      const dayStart = day.toZonedDateTime({
        timeZone,
        plainTime: Temporal.PlainTime.from("00:00"),
      });
      const dayEndZdt = dayStart.add({ days: 1 });

      const whoopItems: PositionedItem[] = allWorkouts
        .filter((w) => {
          const wStart = isoStringToZonedDateTime(w.start, timeZone);
          const wEnd = isoStringToZonedDateTime(w.end, timeZone);
          return (
            Temporal.ZonedDateTime.compare(wEnd, dayStart) > 0 &&
            Temporal.ZonedDateTime.compare(wStart, dayEndZdt) < 0
          );
        })
        .map((workout) => {
          const wStart = isoStringToZonedDateTime(workout.start, timeZone);
          const wEnd = isoStringToZonedDateTime(workout.end, timeZone);
          const clampedStart =
            Temporal.ZonedDateTime.compare(wStart, dayStart) < 0
              ? dayStart
              : wStart;
          const clampedEnd =
            Temporal.ZonedDateTime.compare(wEnd, dayEndZdt) > 0
              ? dayEndZdt
              : wEnd;
          const startMin = minutesFromMidnight(clampedStart);
          const rawEndMin = minutesFromMidnight(clampedEnd);
          const endMin = rawEndMin === 0 && startMin > 0 ? 1440 : rawEndMin;
          return {
            id: `whoop-workout-${workout.id}`,
            type: "whoop-workout" as const,
            startMinutes: startMin,
            endMinutes: Math.max(endMin, startMin + 15),
          };
        });

      // Calculate layout for all items on this day
      const allItems = [...taskItems, ...googleItems, ...whoopItems];
      const layout = calculateCollisionLayout(allItems);
      layoutsByDay.set(dayKey, layout);
    }

    return layoutsByDay;
  }, [visibleDays, tasksByDay, timedEventsByDay, allWorkouts, timeZone]);

  // Each day column width as percentage of the parent container
  const dayColumnWidth = `${100 / visibleDays.length}%`;

  return (
    <div className="flex h-full">
      {/* Fixed time gutter column */}
      <div className="flex w-16 shrink-0 flex-col border-r bg-background">
        {/* Empty corner cell above time gutter - height matches header block */}
        <div className="shrink-0 border-b" style={{ height: headerHeight }} />
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
                    isTodayHighlight={isToday(day, timeZone)}
                    key={dayKey}
                    whoopSummary={whoopSummaries.get(dayKey)}
                    width={dayColumnWidth}
                  />
                );
              })}
            </div>

            {hasAllDayEvents ? (
              <div className="flex border-border border-t bg-background/80">
                {visibleDays.map((day) => {
                  const dayKey = day.toString();
                  const dayAllDay = allDayEventsByDay.get(dayKey) ?? [];

                  return (
                    <div
                      className="flex min-h-[32px] flex-col items-start gap-1 overflow-hidden border-border border-r px-2 pt-1 pb-1 last:border-r-0"
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
                        <span className="block w-full truncate rounded-sm bg-muted px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground">
                          …
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {/* Scrollable day columns - vertical only */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ref={scrollRef}
        >
          <div className="flex w-full">
            {visibleDays.map((day) => {
              const dayKey = day.toString();
              const dayTasks = tasksByDay.get(dayKey) ?? [];
              const dayGoogleEvents = timedEventsByDay?.get(dayKey) ?? [];
              const dayLayouts = collisionLayoutsByDay.get(dayKey);

              return (
                <DayColumn
                  date={day}
                  key={dayKey}
                  onSlotDragMove={handleSlotDragMove}
                  onSlotHover={handleSlotHover}
                  onSlotLeave={handleSlotLeave}
                  onSlotMouseDown={handleSlotMouseDown}
                  onSlotMouseUp={handleSlotMouseUp}
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
                  {/* Creation preview for this column */}
                  <CreationPreview columnDate={day} />
                  {hasGoogleEvents
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
                          return (
                            <GoogleCalendarEvent
                              accountId={accountId}
                              calendarId={calendarId}
                              columnIndex={layout?.columnIndex}
                              columnSpan={layout?.columnSpan}
                              end={end}
                              event={event}
                              key={`${accountId}-${calendarId}-${event.id}-${start.toString()}`}
                              start={start}
                              totalColumns={layout?.totalColumns}
                              zIndex={layout?.zIndex}
                            />
                          );
                        }
                      )
                    : null}
                  {dayTasks.map((task) => {
                    const layoutKey = `task-${task.id}`;
                    const layout = dayLayouts?.get(layoutKey);
                    return (
                      <TaskEvent
                        columnIndex={layout?.columnIndex}
                        columnSpan={layout?.columnSpan}
                        key={task.id}
                        task={task}
                        totalColumns={layout?.totalColumns}
                        zIndex={layout?.zIndex}
                      />
                    );
                  })}
                  {/* WHOOP workout event blocks — rendered from all
                      collected workouts so cross-midnight workouts
                      appear in both day columns. */}
                  {allWorkouts.map((workout) => {
                    const layoutKey = `whoop-workout-${workout.id}`;
                    const layout = dayLayouts?.get(layoutKey);
                    if (!layout) {
                      return null;
                    }
                    return (
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
                    );
                  })}
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

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  return (
    <div className="h-full overflow-hidden" ref={gutterRef}>
      <TimeGutter />
    </div>
  );
}

/**
 * Calculate the vertical position and height of an event based on its time.
 * Returns CSS values for top and height.
 */
export function calculateEventPosition(
  startTime: Temporal.ZonedDateTime,
  durationMinutes: number
): { top: string; height: string } {
  const startHour = minutesFromMidnight(startTime) / 60;
  const durationHours = durationMinutes / 60;

  // Grid starts at midnight (hour 0)
  const top = startHour * PIXELS_PER_HOUR;
  const height = durationHours * PIXELS_PER_HOUR;

  return {
    top: `${top}px`,
    // Minimum height matches a 15-minute slot (20px).
    height: `${Math.max(height, 20)}px`,
  };
}

DaysView.displayName = "DaysView";

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

  const { background: backgroundColor, foreground: foregroundColor } =
    resolveGoogleEventColors({
      colorId: item.event.colorId,
      palette: normalizedPalette?.event,
      calendarBackgroundColor: calendar?.calendar.backgroundColor,
      calendarForegroundColor: calendar?.calendar.foregroundColor,
    });

  const endDate =
    item.event.end.date && item.event.end.date !== item.date.toString()
      ? parseDateOnlyLocal(item.event.end.date)
      : item.date.add({ days: 1 });
  const startZdt = item.date.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
  const endZdt = endDate.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("00:00"),
  });

  return (
    <EventEditPopover
      accountId={item.accountId}
      calendarId={item.calendarId}
      end={zonedDateTimeToDate(endZdt)}
      event={item.event}
      start={zonedDateTimeToDate(startZdt)}
    >
      <button
        className="block w-full max-w-full rounded-sm bg-background p-px text-left"
        style={{
          ...(foregroundColor && { color: foregroundColor }),
        }}
        title={item.event.summary ?? "Google event"}
        type="button"
      >
        <span
          className={`block w-full max-w-full truncate rounded-[3px] border border-black/20 px-1.5 py-0.5 font-medium text-[11px] dark:border-white/30 ${
            backgroundColor ? "" : "bg-primary/10 text-primary"
          }`}
          style={{
            ...(backgroundColor && {
              backgroundColor,
            }),
            ...(foregroundColor && { color: foregroundColor }),
          }}
        >
          {item.event.summary ?? "Google event"}
        </span>
      </button>
    </EventEditPopover>
  );
}
