"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  type Event as GoogleEvent,
  getGoogleEventEditBlockReason,
  isGoogleEventEditable,
} from "@kompose/google-cal/schema";
import {
  normalizedGoogleColorsAtomFamily,
  resolveGoogleEventColors,
} from "@kompose/state/atoms/google-colors";
import { googleCalendarsDataAtom } from "@kompose/state/atoms/google-data";
import { extractMeetingLink } from "@kompose/state/meeting";
import { useAtomValue } from "jotai";
import { Lock, MapPin, Video } from "lucide-react";
import { memo, useMemo } from "react";
import type { Temporal } from "temporal-polyfill";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { zonedDateTimeToDate } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR } from "../constants";
import { calculateEventPosition } from "../event-position";
import { BlockContent, type BlockDetail, eventColor } from "./block-content";
import { EventEditPopover } from "./event-edit-popover";

/** The meeting provider, or else the place, shown under an event's time. */
function eventDetails(event: GoogleEvent): BlockDetail[] {
  const meeting = extractMeetingLink(event);
  if (meeting) {
    return [{ icon: Video, label: meeting.label }];
  }
  const place = event.location?.trim();
  return place ? [{ icon: MapPin, label: place }] : [];
}

interface GoogleCalendarEventProps {
  accountId: string;
  calendarId: string;
  columnIndex?: number;
  columnSpan?: number;
  end: Temporal.ZonedDateTime;
  event: GoogleEvent;
  start: Temporal.ZonedDateTime;
  totalColumns?: number;
  zIndex?: number;
}

export const GoogleCalendarEvent = memo(function GoogleCalendarEventInner({
  event,
  start,
  end,
  accountId,
  calendarId,
  columnIndex = 0,
  totalColumns = 1,
  columnSpan = 1,
  zIndex = 1,
}: GoogleCalendarEventProps) {
  const durationMinutes = Math.max(
    1,
    Math.round(end.since(start).total({ unit: "minutes" }))
  );
  const isEditable = isGoogleEventEditable(event);
  const editBlockedReason = getGoogleEventEditBlockReason(event);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    data: {
      accountId,
      calendarId,
      end,
      event,
      start,
      type: "google-event",
    },
    disabled: !isEditable,
    id: `google-event-${calendarId}-${event.id}`,
  });

  const {
    attributes: startAttributes,
    listeners: startListeners,
    setNodeRef: setStartHandleRef,
  } = useDraggable({
    data: {
      accountId,
      calendarId,
      direction: "start",
      end,
      event,
      start,
      type: "google-event-resize",
    },
    disabled: !isEditable,
    id: `google-event-${calendarId}-${event.id}-resize-start`,
  });

  const {
    attributes: endAttributes,
    listeners: endListeners,
    setNodeRef: setEndHandleRef,
  } = useDraggable({
    data: {
      accountId,
      calendarId,
      direction: "end",
      end,
      event,
      start,
      type: "google-event-resize",
    },
    disabled: !isEditable,
    id: `google-event-${calendarId}-${event.id}-resize-end`,
  });

  const { top, height } = calculateEventPosition(start, durationMinutes);

  const normalizedPalette = useAtomValue(
    normalizedGoogleColorsAtomFamily(accountId)
  );
  const calendars = useAtomValue(googleCalendarsDataAtom);

  // Find the calendar this event belongs to, for fallback colors
  const calendar = calendars.find(
    (c) => c.accountId === accountId && c.calendar.id === calendarId
  );

  const { background: backgroundColor } = resolveGoogleEventColors({
    calendarBackgroundColor: calendar?.calendar.backgroundColor,
    calendarForegroundColor: calendar?.calendar.foregroundColor,
    colorId: event.colorId,
    palette: normalizedPalette?.event,
  });

  // columnSpan lets items expand into adjacent empty columns
  const singleColumnWidth = 100 / totalColumns;
  const columnWidth = singleColumnWidth * columnSpan;
  const leftPercent = columnIndex * singleColumnWidth;

  const style: React.CSSProperties = {
    height,
    left: `calc(${leftPercent}% + 2px)`,
    position: "absolute",
    top,
    width: `calc(${columnWidth}% - 4px)`,
    zIndex,
  };

  const eventColorStyle = eventColor(backgroundColor);
  const details = useMemo(() => eventDetails(event), [event]);

  const eventCard = (
    <div
      className={cn(
        "group pointer-events-auto rounded-md bg-background p-px transition-shadow",
        "relative",
        isEditable
          ? "cursor-grab hover:shadow-sm"
          : "cursor-default opacity-90",
        isDragging ? "opacity-0" : ""
      )}
      ref={setNodeRef}
      style={style}
      title={editBlockedReason ?? undefined}
      {...attributes}
      {...listeners}
    >
      <div
        className={cn(
          "event-surface h-full overflow-hidden rounded-[5px] pr-1.5 pl-2",
          durationMinutes < 30 ? "py-0" : "py-1",
          isEditable ? "" : "pr-5"
        )}
        style={eventColorStyle}
      >
        <BlockContent
          details={details}
          end={end}
          start={start}
          title={event.summary || "(No title)"}
        />
        {!isEditable && editBlockedReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="absolute top-1 right-1 inline-flex size-4 items-center justify-center rounded-full bg-background/70 text-foreground/70"
                title=""
              >
                <Lock className="size-2.5" />
                <span className="sr-only">{editBlockedReason}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{editBlockedReason}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {isEditable ? (
        <>
          <div
            className="absolute inset-x-0 -top-1 h-3 cursor-n-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
            ref={setStartHandleRef}
            {...startAttributes}
            {...startListeners}
          />
          <div
            className="absolute inset-x-0 -bottom-1 h-3 cursor-s-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
            ref={setEndHandleRef}
            {...endAttributes}
            {...endListeners}
          />
        </>
      ) : null}
    </div>
  );

  return (
    <EventEditPopover
      accountId={accountId}
      calendarId={calendarId}
      end={zonedDateTimeToDate(end)}
      event={event}
      readOnly={!isEditable}
      readOnlyReason={editBlockedReason}
      start={zonedDateTimeToDate(start)}
    >
      {eventCard}
    </EventEditPopover>
  );
});

export const GoogleCalendarEventPreview = memo(
  function GoogleCalendarEventPreviewInner({
    event,
    start,
    end,
    accountId,
    calendarId,
  }: {
    event: GoogleEvent;
    start: Temporal.ZonedDateTime;
    end: Temporal.ZonedDateTime;
    accountId: string;
    calendarId: string;
  }) {
    const normalizedPalette = useAtomValue(
      normalizedGoogleColorsAtomFamily(accountId)
    );
    const calendars = useAtomValue(googleCalendarsDataAtom);
    const calendar = calendars.find(
      (c) => c.accountId === accountId && c.calendar.id === calendarId
    );
    const { background: backgroundColor } = resolveGoogleEventColors({
      calendarBackgroundColor: calendar?.calendar.backgroundColor,
      calendarForegroundColor: calendar?.calendar.foregroundColor,
      colorId: event.colorId,
      palette: normalizedPalette?.event,
    });
    const durationMinutes = Math.max(
      1,
      Math.round(end.since(start).total({ unit: "minutes" }))
    );
    const isShortEvent = durationMinutes <= 15;
    const shortEventHeight = (15 / 60) * PIXELS_PER_HOUR;

    return (
      <div
        className="w-48 cursor-grabbing rounded-md bg-background p-px shadow-lg"
        style={isShortEvent ? { height: shortEventHeight } : undefined}
      >
        <div
          className={cn(
            "event-surface rounded-[5px] pr-1.5 pl-2",
            isShortEvent ? "h-full py-0" : "py-1"
          )}
          style={eventColor(backgroundColor)}
        >
          <BlockContent
            end={end}
            start={start}
            title={event.summary || "(No title)"}
          />
        </div>
      </div>
    );
  }
);
