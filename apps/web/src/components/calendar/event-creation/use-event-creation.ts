"use client";

import {
  googleCalendarsDataAtom,
  resolvedVisibleCalendarIdsAtom,
} from "@kompose/state/atoms/google-data";
import { useAtomValue } from "jotai";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Temporal } from "temporal-polyfill";
import { isSameDay } from "@/lib/temporal-utils";
import { PIXELS_PER_HOUR } from "../constants";
import { MINUTES_STEP } from "../dnd/helpers";

/** Default event duration in minutes when clicking (not dragging) */
export const DEFAULT_EVENT_DURATION_MINUTES = 30;

/** State for event creation via click-and-drag */
interface EventCreationState {
  /** Which Google account to use */
  accountId: string | null;
  /** Which calendar to create on */
  calendarId: string | null;
  /** Current drag end position (null when not creating) */
  endDateTime: Temporal.ZonedDateTime | null;
  /** Hover preview position when not dragging */
  hoverDateTime: Temporal.ZonedDateTime | null;
  /** Currently in creation drag mode */
  isCreating: boolean;
  /** Reference to the preview element for popover positioning */
  previewElement: HTMLDivElement | null;
  /** Whether the popover should be open after creation ends */
  showPopover: boolean;
  /** Where the drag started (null when not creating) */
  startDateTime: Temporal.ZonedDateTime | null;
}

/** Actions for managing event creation */
interface EventCreationActions {
  /** Cancel creation (e.g., Escape key) */
  cancelCreation: () => void;
  /** Close the popover */
  closePopover: () => void;
  /** Called when mouse moves to a different slot during drag */
  onSlotDragMove: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse enters a time slot (for hover preview) */
  onSlotHover: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse leaves the calendar area */
  onSlotLeave: () => void;
  /** Called when mouse down on a time slot (start creation) */
  onSlotMouseDown: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse up to end creation */
  onSlotMouseUp: () => void;
  /** Set the preview element ref for popover positioning */
  setPreviewElement: (element: HTMLDivElement | null) => void;
}

interface EventCreationContextValue {
  actions: EventCreationActions;
  /** Computed start/end for popover (with minimum duration applied) */
  popoverTimes: {
    start: Temporal.ZonedDateTime;
    end: Temporal.ZonedDateTime;
  } | null;
  state: EventCreationState;
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
  const context = use(EventCreationContext);
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

  // Refs for document-level drag listeners. The slot-level React listeners
  // stop firing when the cursor crosses an existing event (events render with
  // `pointer-events-auto` above the slots). Document-level native listeners
  // aren't blocked, so we attach them on mousedown and remove on mouseup.
  const startDateTimeRef = useRef<Temporal.ZonedDateTime | null>(null);
  const documentListenerCleanupRef = useRef<(() => void) | null>(null);

  // Safety: remove any leaked document listeners on unmount.
  useEffect(() => () => documentListenerCleanupRef.current?.(), []);

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
    documentListenerCleanupRef.current?.();
    setState((prev) => {
      if (!prev.isCreating) {
        return prev;
      }
      return {
        ...prev,
        isCreating: false,
        showPopover: true,
      };
    });
  }, []);

  // Start creation on mouse down, centered on cursor position.
  // Also attaches document-level mousemove/mouseup so the drag stays
  // continuous even when the cursor passes over existing events.
  const onSlotMouseDown = useCallback(
    (dateTime: Temporal.ZonedDateTime) => {
      if (!defaultCalendar) {
        return;
      }
      documentListenerCleanupRef.current?.();

      const halfDuration = DEFAULT_EVENT_DURATION_MINUTES / 2;
      const centeredStart = dateTime.subtract({ minutes: halfDuration });
      startDateTimeRef.current = centeredStart;

      setState((prev) => ({
        ...prev,
        isCreating: true,
        startDateTime: centeredStart,
        endDateTime: centeredStart.add({
          minutes: DEFAULT_EVENT_DURATION_MINUTES,
        }),
        hoverDateTime: null,
        calendarId: defaultCalendar.calendarId,
        accountId: defaultCalendar.accountId,
        showPopover: false,
      }));

      const handleDocumentMouseMove = (e: MouseEvent) => {
        const start = startDateTimeRef.current;
        if (!start) {
          return;
        }

        // `closest()` walks up the DOM tree, so it finds the day column even
        // when the topmost element is an existing event sitting inside it.
        const target = document.elementFromPoint(
          e.clientX,
          e.clientY
        ) as HTMLElement | null;
        const column = target?.closest(
          "[data-day-column]"
        ) as HTMLElement | null;
        if (!column) {
          return;
        }

        const rect = column.getBoundingClientRect();
        const offsetY = Math.min(
          Math.max(e.clientY - rect.top, 0),
          rect.height
        );
        const minutesFromTop = (offsetY / PIXELS_PER_HOUR) * 60;
        const snappedMinutes =
          Math.round(minutesFromTop / MINUTES_STEP) * MINUTES_STEP;
        const clampedMinutes = Math.min(
          Math.max(snappedMinutes, 0),
          24 * 60 - MINUTES_STEP
        );

        const snapped = Temporal.ZonedDateTime.from({
          year: start.year,
          month: start.month,
          day: start.day,
          hour: Math.floor(clampedMinutes / 60),
          minute: clampedMinutes % 60,
          timeZone: start.timeZoneId,
        });

        onSlotDragMove(snapped);
      };

      const handleDocumentMouseUp = (e: MouseEvent) => {
        if (e.button !== 0) {
          return;
        }
        onSlotMouseUp();
      };

      document.addEventListener("mousemove", handleDocumentMouseMove);
      document.addEventListener("mouseup", handleDocumentMouseUp);

      documentListenerCleanupRef.current = () => {
        document.removeEventListener("mousemove", handleDocumentMouseMove);
        document.removeEventListener("mouseup", handleDocumentMouseUp);
        documentListenerCleanupRef.current = null;
      };
    },
    [defaultCalendar, onSlotDragMove, onSlotMouseUp]
  );

  // Cancel creation entirely
  const cancelCreation = useCallback(() => {
    documentListenerCleanupRef.current?.();
    setState(initialState);
  }, []);

  // Close popover (after save or discard)
  const closePopover = useCallback(() => {
    documentListenerCleanupRef.current?.();
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
