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
import type { ItemLayout } from "@kompose/state/collision-utils";
import { useAtomValue } from "jotai";
import { Lock } from "lucide-react";
import { memo } from "react";
import type { Temporal } from "temporal-polyfill";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTime, zonedDateTimeToDate } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR } from "../constants";
import {
  BLOCK_RAISE_CLASS,
  blockHorizontalStyle,
  blockStackStyle,
  calculateEventPosition,
} from "../event-position";
import { EventEditPopover } from "./event-edit-popover";

interface GoogleCalendarEventProps {
  accountId: string;
  calendarId: string;
  end: Temporal.ZonedDateTime;
  event: GoogleEvent;
  layout?: ItemLayout;
  start: Temporal.ZonedDateTime;
}

export const GoogleCalendarEvent = memo(function GoogleCalendarEventInner({
  layout,
  event,
  start,
  end,
  accountId,
  calendarId,
}: GoogleCalendarEventProps) {
  const durationMinutes = Math.max(
    1,
    Math.round(end.since(start).total({ unit: "minutes" }))
  );
  const isShortEvent = durationMinutes <= 15;
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

  const { background: backgroundColor, foreground: foregroundColor } =
    resolveGoogleEventColors({
      calendarBackgroundColor: calendar?.calendar.backgroundColor,
      calendarForegroundColor: calendar?.calendar.foregroundColor,
      colorId: event.colorId,
      palette: normalizedPalette?.event,
    });

  const style: React.CSSProperties = {
    height,
    ...blockHorizontalStyle(layout),
    position: "absolute",
    top,
    ...blockStackStyle(layout?.zIndex),
  };

  const fillStyle: React.CSSProperties = {
    backgroundColor: backgroundColor ?? "hsl(var(--primary))",
    color: foregroundColor ?? "hsl(var(--primary-foreground))",
  };

  const eventCard = (
    <div
      className={cn(
        "group pointer-events-auto rounded-md bg-background p-px shadow-sm transition-shadow",
        "relative",
        BLOCK_RAISE_CLASS,
        isEditable
          ? "cursor-grab hover:shadow-md"
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
          "h-full rounded-[5px] border border-black/20 px-2 py-1 dark:border-white/30",
          isShortEvent ? "flex items-center py-0" : ""
        )}
        style={fillStyle}
      >
        {!isEditable && editBlockedReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="absolute top-1 right-1 inline-flex size-4 items-center justify-center rounded-full bg-black/15 text-current opacity-90"
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
        <div className="min-w-0 truncate font-medium text-xs">
          {event.summary ?? "Google event"}
        </div>
        {/* Hide time for short events (<30min) to prevent overflow */}
        {durationMinutes >= 30 && (
          <div className="truncate text-[10px] opacity-85">
            {formatTime(start)} - {formatTime(end)}
          </div>
        )}
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
    const { background: backgroundColor, foreground: foregroundColor } =
      resolveGoogleEventColors({
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

    const fillStyle: React.CSSProperties = {
      backgroundColor: backgroundColor ?? "hsl(var(--primary))",
      color: foregroundColor ?? "hsl(var(--primary-foreground))",
    };

    return (
      <div
        className="w-48 cursor-grabbing rounded-md bg-background p-px shadow-lg"
        style={isShortEvent ? { height: shortEventHeight } : undefined}
      >
        <div
          className={cn(
            "rounded-[5px] border border-black/20 px-2 py-1 dark:border-white/30",
            isShortEvent ? "flex h-full items-center py-0" : ""
          )}
          style={fillStyle}
        >
          <div className="min-w-0 truncate font-medium text-xs">
            {event.summary ?? "Google event"}
          </div>
          {isShortEvent ? null : (
            <div className="truncate text-[10px] opacity-80">
              {formatTime(start)}
            </div>
          )}
        </div>
      </div>
    );
  }
);
