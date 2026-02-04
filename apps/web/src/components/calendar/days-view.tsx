"use client";

import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  timezoneAtom,
  visibleDaysAtom,
} from "@kompose/state/atoms/current-date";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@kompose/state/atoms/google-colors";
import {
  type GoogleEventWithSource,
  googleCalendarsDataAtom,
} from "@kompose/state/atoms/google-data";
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
import {
  calculateCollisionLayout,
  type ItemLayout,
  type PositionedItem,
} from "./collision-utils";
import { PIXELS_PER_HOUR } from "./constants";
import { CreationPreview } from "./event-creation/creation-preview";
import { EventCreationPopover } from "./event-creation/event-creation-popover";
import { EventCreationProvider } from "./event-creation/event-creation-provider";
import { useEventCreation } from "./event-creation/use-event-creation";
import { EventEditPopover } from "./events/event-edit-popover";
import { GoogleCalendarEvent } from "./events/google-event";
import { TaskEvent } from "./events/task-event";
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

    const dayKey = positioned.start.toPlainDate().toString();
    const dayEvents = timed.get(dayKey);
    if (dayEvents) {
      dayEvents.push(positioned);
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
  /** All tasks to display (will be filtered to scheduled ones) */
  tasks: TaskSelectDecoded[];
  /** Google events (raw from API) to render separately from tasks */
  googleEvents?: GoogleEventWithSource[];
}

/**
 * DaysView - Displays 1-7 days starting from the current date.
 * Wrapped with EventCreationProvider to enable click-and-drag event creation.
 */
export const DaysView = memo(function DaysViewComponent({
  tasks,
  googleEvents = [],
}: DaysViewProps) {
  return (
    <EventCreationProvider>
      <DaysViewInner googleEvents={googleEvents} tasks={tasks} />
    </EventCreationProvider>
  );
});

/**
 * Inner component that has access to EventCreationContext.
 */
const DaysViewInner = memo(function DaysViewInnerComponent({
  tasks,
  googleEvents = [],
}: DaysViewProps) {
  const visibleDays = useAtomValue(visibleDaysAtom);
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

  // Group scheduled tasks by day for efficient rendering
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, TaskSelectDecoded[]>();

    for (const day of visibleDays) {
      const dayKey = day.toString();
      grouped.set(dayKey, []);
    }

    for (const task of scheduledTasks) {
      if (!task.startDate) {
        continue;
      }
      // Use startDate directly for grouping (startDate is PlainDate)
      const dayKey = task.startDate.toString();
      const dayTasks = grouped.get(dayKey);
      if (dayTasks) {
        dayTasks.push(task);
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

  // Calculate collision layouts for all visible days
  // Combines tasks and google events into unified collision groups
  const collisionLayoutsByDay = useMemo(() => {
    const layoutsByDay = new Map<string, Map<string, ItemLayout>>();

    for (const day of visibleDays) {
      const dayKey = day.toString();
      const dayTasks = tasksByDay.get(dayKey) ?? [];
      const dayGoogleEvents = timedEventsByDay.get(dayKey) ?? [];

      // Convert tasks to PositionedItems
      // Filter and type-narrow to tasks with both startDate and startTime
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
          const endMinutes = startMinutes + (task.durationMinutes ?? 30);
          return {
            id: `task-${task.id}`,
            type: "task" as const,
            startMinutes,
            endMinutes,
          };
        });

      // Convert google events to PositionedItems
      const googleItems: PositionedItem[] = dayGoogleEvents.map((ge) => {
        const startMinutes = minutesFromMidnight(ge.start);
        const endMinutes = minutesFromMidnight(ge.end);
        return {
          id: `google-${ge.calendarId}-${ge.event.id}`,
          type: "google-event" as const,
          startMinutes,
          // Handle events that might cross midnight or have same start/end
          endMinutes:
            endMinutes > startMinutes ? endMinutes : startMinutes + 30,
        };
      });

      // Calculate layout for all items on this day
      const allItems = [...taskItems, ...googleItems];
      const layout = calculateCollisionLayout(allItems);
      layoutsByDay.set(dayKey, layout);
    }

    return layoutsByDay;
  }, [visibleDays, tasksByDay, timedEventsByDay, timeZone]);

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
              {visibleDays.map((day) => (
                <DayHeader
                  date={day}
                  isTodayHighlight={isToday(day, timeZone)}
                  key={day.toString()}
                  width={dayColumnWidth}
                />
              ))}
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
                            key={`${item.calendarId}-${item.event.id}`}
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
                          const layoutKey = `google-${calendarId}-${event.id}`;
                          const layout = dayLayouts?.get(layoutKey);
                          return (
                            <GoogleCalendarEvent
                              accountId={accountId}
                              calendarId={calendarId}
                              columnIndex={layout?.columnIndex}
                              end={end}
                              event={event}
                              key={`${calendarId}-${event.id}-${start.toString()}`}
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
                        key={task.id}
                        task={task}
                        totalColumns={layout?.totalColumns}
                        zIndex={layout?.zIndex}
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

  const eventPalette =
    item.event.colorId && normalizedPalette?.event
      ? normalizedPalette.event[item.event.colorId]
      : undefined;

  const calendar = calendars.find(
    (c) => c.accountId === item.accountId && c.calendar.id === item.calendarId
  );

  const backgroundColor =
    eventPalette?.background ??
    pastelizeColor(calendar?.calendar.backgroundColor) ??
    undefined;
  const foregroundColor =
    eventPalette?.foreground ?? calendar?.calendar.foregroundColor ?? undefined;

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
        className={`block w-full max-w-full truncate rounded-sm border border-transparent px-1.5 py-0.5 text-left font-medium text-[11px] ${
          backgroundColor ? "" : "border-primary/20 bg-primary/10 text-primary"
        }`}
        style={{
          ...(backgroundColor && {
            backgroundColor,
            borderColor: backgroundColor,
          }),
          ...(foregroundColor && { color: foregroundColor }),
        }}
        title={item.event.summary ?? "Google event"}
        type="button"
      >
        {item.event.summary ?? "Google event"}
      </button>
    </EventEditPopover>
  );
}
