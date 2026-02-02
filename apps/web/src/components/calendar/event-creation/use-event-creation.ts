"use client";

import {
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { useAtomValue } from "jotai";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Temporal } from "temporal-polyfill";
import { isSameDay } from "@/lib/temporal-utils";
import { MINUTES_STEP } from "../dnd/helpers";

/** Default event duration in minutes when clicking (not dragging) */
export const DEFAULT_EVENT_DURATION_MINUTES = 30;

/** State for event creation via click-and-drag */
export interface EventCreationState {
  /** Currently in creation drag mode */
  isCreating: boolean;
  /** Where the drag started (null when not creating) */
  startDateTime: Temporal.ZonedDateTime | null;
  /** Current drag end position (null when not creating) */
  endDateTime: Temporal.ZonedDateTime | null;
  /** Hover preview position when not dragging */
  hoverDateTime: Temporal.ZonedDateTime | null;
  /** Which calendar to create on */
  calendarId: string | null;
  /** Which Google account to use */
  accountId: string | null;
  /** Whether the popover should be open after creation ends */
  showPopover: boolean;
  /** Reference to the preview element for popover positioning */
  previewElement: HTMLDivElement | null;
}

/** Actions for managing event creation */
export interface EventCreationActions {
  /** Called when mouse enters a time slot (for hover preview) */
  onSlotHover: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse leaves the calendar area */
  onSlotLeave: () => void;
  /** Called when mouse down on a time slot (start creation) */
  onSlotMouseDown: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse moves to a different slot during drag */
  onSlotDragMove: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse up to end creation */
  onSlotMouseUp: () => void;
  /** Cancel creation (e.g., Escape key) */
  cancelCreation: () => void;
  /** Close the popover */
  closePopover: () => void;
  /** Set the preview element ref for popover positioning */
  setPreviewElement: (element: HTMLDivElement | null) => void;
}

export interface EventCreationContextValue {
  state: EventCreationState;
  actions: EventCreationActions;
  /** Computed start/end for popover (with minimum duration applied) */
  popoverTimes: {
    start: Temporal.ZonedDateTime;
    end: Temporal.ZonedDateTime;
  } | null;
}

const initialState: EventCreationState = {
  isCreating: false,
  startDateTime: null,
  endDateTime: null,
  hoverDateTime: null,
  calendarId: null,
  accountId: null,
  showPopover: false,
  previewElement: null,
};

export const EventCreationContext =
  createContext<EventCreationContextValue | null>(null);

/**
 * Hook to access event creation context.
 * Must be used within EventCreationProvider.
 */
export function useEventCreation(): EventCreationContextValue {
  const context = useContext(EventCreationContext);
  if (!context) {
    throw new Error(
      "useEventCreation must be used within EventCreationProvider"
    );
  }
  return context;
}

/**
 * Hook to manage event creation state.
 * Returns state and actions for the EventCreationProvider.
 */
export function useEventCreationState(): EventCreationContextValue {
  const visibleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const allCalendars = useAtomValue(googleCalendarsDataAtom);

  const [state, setState] = useState<EventCreationState>(initialState);

  // Get the first visible calendar (primary preference) for creating events
  const defaultCalendar = useMemo(() => {
    if (visibleCalendars.length === 0) {
      return null;
    }
    // Try to find a primary calendar first
    const primaryCalendar = allCalendars.find(
      (c) =>
        c.calendar.primary &&
        visibleCalendars.some(
          (v) => v.accountId === c.accountId && v.calendarId === c.calendar.id
        )
    );
    if (primaryCalendar) {
      return {
        accountId: primaryCalendar.accountId,
        calendarId: primaryCalendar.calendar.id,
      };
    }
    // Fall back to first visible calendar
    return visibleCalendars[0];
  }, [visibleCalendars, allCalendars]);

  // Update hover preview position
  const onSlotHover = useCallback((dateTime: Temporal.ZonedDateTime) => {
    setState((prev) => {
      // Don't update hover if we're in creation mode
      if (prev.isCreating) {
        return prev;
      }
      return { ...prev, hoverDateTime: dateTime };
    });
  }, []);

  // Clear hover preview when leaving calendar
  const onSlotLeave = useCallback(() => {
    setState((prev) => {
      if (prev.isCreating) {
        return prev;
      }
      return { ...prev, hoverDateTime: null };
    });
  }, []);

  // Start creation on mouse down
  const onSlotMouseDown = useCallback(
    (dateTime: Temporal.ZonedDateTime) => {
      if (!defaultCalendar) {
        return;
      }
      setState((prev) => ({
        ...prev,
        isCreating: true,
        startDateTime: dateTime,
        endDateTime: dateTime.add({ minutes: DEFAULT_EVENT_DURATION_MINUTES }),
        hoverDateTime: null,
        calendarId: defaultCalendar.calendarId,
        accountId: defaultCalendar.accountId,
        showPopover: false,
      }));
    },
    [defaultCalendar]
  );

  // Update end position during drag
  const onSlotDragMove = useCallback((dateTime: Temporal.ZonedDateTime) => {
    setState((prev) => {
      if (!(prev.isCreating && prev.startDateTime)) {
        return prev;
      }
      // Only allow same-day creation
      if (!isSameDay(prev.startDateTime, dateTime)) {
        return prev;
      }

      // Add MINUTES_STEP to get the bottom of the slot
      const slotEnd = dateTime.add({ minutes: MINUTES_STEP });

      // Determine if dragging forward or backward
      const isForward =
        Temporal.ZonedDateTime.compare(slotEnd, prev.startDateTime) > 0;

      if (isForward) {
        // Dragging forward: start stays, end moves
        return { ...prev, endDateTime: slotEnd };
      }
      // Dragging backward: swap - dateTime becomes new start, original start becomes end
      return {
        ...prev,
        startDateTime: dateTime,
        endDateTime: prev.startDateTime.add({
          minutes: DEFAULT_EVENT_DURATION_MINUTES,
        }),
      };
    });
  }, []);

  // End creation on mouse up, show popover
  const onSlotMouseUp = useCallback(() => {
    setState((prev) => {
      if (!prev.isCreating) {
        return prev;
      }
      // Keep the state but show the popover
      return {
        ...prev,
        isCreating: false,
        showPopover: true,
      };
    });
  }, []);

  // Cancel creation entirely
  const cancelCreation = useCallback(() => {
    setState(initialState);
  }, []);

  // Close popover (after save or discard)
  const closePopover = useCallback(() => {
    setState(initialState);
  }, []);

  // Set the preview element ref for popover positioning
  const setPreviewElement = useCallback((element: HTMLDivElement | null) => {
    setState((prev) => ({ ...prev, previewElement: element }));
  }, []);

  const actions: EventCreationActions = useMemo(
    () => ({
      onSlotHover,
      onSlotLeave,
      onSlotMouseDown,
      onSlotDragMove,
      onSlotMouseUp,
      cancelCreation,
      closePopover,
      setPreviewElement,
    }),
    [
      onSlotHover,
      onSlotLeave,
      onSlotMouseDown,
      onSlotDragMove,
      onSlotMouseUp,
      cancelCreation,
      closePopover,
      setPreviewElement,
    ]
  );

  // Compute popover times with minimum duration applied
  const popoverTimes = useMemo(() => {
    if (!(state.startDateTime && state.endDateTime)) {
      return null;
    }
    const start = state.startDateTime;
    let end = state.endDateTime;

    // Ensure minimum duration
    const duration = end.since(start).total({ unit: "minutes" });
    if (duration < MINUTES_STEP) {
      end = start.add({ minutes: DEFAULT_EVENT_DURATION_MINUTES });
    }

    return { start, end };
  }, [state.startDateTime, state.endDateTime]);

  return useMemo(
    () => ({
      state,
      actions,
      popoverTimes,
    }),
    [state, actions, popoverTimes]
  );
}
