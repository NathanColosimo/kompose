"use client";

import { useMemo } from "react";
import { zonedDateTimeToDate } from "@/lib/temporal-utils";
import { EventEditPopover } from "../events/event-edit-popover";
import { useEventCreation } from "./use-event-creation";

/**
 * EventCreationPopover - Renders EventEditPopover in create mode.
 * Uses the creation preview as the anchor and manages controlled open state.
 */
export function EventCreationPopover() {
  const { state, actions, popoverTimes } = useEventCreation();

  // Convert ZonedDateTime to Date for the popover
  const startDate = useMemo(
    () => (popoverTimes ? zonedDateTimeToDate(popoverTimes.start) : new Date()),
    [popoverTimes]
  );

  const endDate = useMemo(
    () => (popoverTimes ? zonedDateTimeToDate(popoverTimes.end) : new Date()),
    [popoverTimes]
  );

  // Don't render if not showing or missing required data
  if (
    !(state.showPopover && popoverTimes && state.accountId && state.calendarId)
  ) {
    return null;
  }

  // We need to render the popover with its trigger
  // The trigger is a hidden span, but we use controlled mode
  return (
    <EventEditPopover
      accountId={state.accountId}
      align="start"
      calendarId={state.calendarId}
      end={endDate}
      mode="create"
      onOpenChange={(open) => {
        if (!open) {
          actions.closePopover();
        }
      }}
      open={state.showPopover}
      side="right"
      start={startDate}
    >
      {/* 
        Hidden trigger - the popover is controlled via open prop.
        We position this at the preview element location.
      */}
      <span
        style={{
          position: "fixed",
          top: state.previewElement?.getBoundingClientRect().top ?? 0,
          left: state.previewElement?.getBoundingClientRect().right ?? 0,
          width: "1px",
          height: state.previewElement?.getBoundingClientRect().height ?? 20,
          pointerEvents: "none",
        }}
      />
    </EventEditPopover>
  );
}
