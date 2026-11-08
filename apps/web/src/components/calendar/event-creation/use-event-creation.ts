"use client";

import { canWriteCalendar } from "@kompose/google-cal/schema";
import {
  googleAccountsDataAtom,
  googleCalendarsDataAtom,
  googleCalendarsLoadingAtom,
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

export const DEFAULT_EVENT_DURATION_MINUTES = 30;

type CreateAtResult = "created" | "waiting";

interface EventCreationState {
  accountId: string | null;
  calendarId: string | null;
  endDateTime: Temporal.ZonedDateTime | null;
  hoverDateTime: Temporal.ZonedDateTime | null;
  isCreating: boolean;
  /** Reference to the preview element for popover positioning */
  previewElement: HTMLDivElement | null;
  showPopover: boolean;
  startDateTime: Temporal.ZonedDateTime | null;
}

interface EventCreationActions {
  cancelCreation: () => void;
  closePopover: () => void;
  /**
   * Open the new-event popover for a 30-minute range at `start`. "waiting"
   * while the calendars load. With no calendar to write to it still opens,
   * for a task; its Event tab says why (eventUnavailableReason).
   */
  createAt: (start: Temporal.ZonedDateTime) => CreateAtResult;
  onSlotDragMove: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotHover: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotLeave: () => void;
  onSlotMouseDown: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotMouseUp: () => void;
  setPreviewElement: (element: HTMLDivElement | null) => void;
}

interface EventCreationContextValue {
  actions: EventCreationActions;
  /** Why the chooser can't make an event (no writable calendar shown). */
  eventUnavailableReason: string | null;
  /** Computed start/end for popover (with minimum duration applied) */
  popoverTimes: {
    start: Temporal.ZonedDateTime;
    end: Temporal.ZonedDateTime;
  } | null;
  state: EventCreationState;
}

const initialState: EventCreationState = {
  accountId: null,
  calendarId: null,
  endDateTime: null,
  hoverDateTime: null,
  isCreating: false,
  previewElement: null,
  showPopover: false,
  startDateTime: null,
};

export const EventCreationContext =
  createContext<EventCreationContextValue | null>(null);

/** Read the EventCreationContext supplied by DaysView. */
export function useEventCreation(): EventCreationContextValue {
  const context = use(EventCreationContext);
  if (!context) {
    throw new Error(
      "useEventCreation must be used within EventCreationProvider"
    );
  }
  return context;
}

/** State and actions that DaysView provides through EventCreationContext. */
export function useEventCreationState(): EventCreationContextValue {
  const visibleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const allCalendars = useAtomValue(googleCalendarsDataAtom);
  const googleAccounts = useAtomValue(googleAccountsDataAtom);
  const isLoadingCalendars = useAtomValue(googleCalendarsLoadingAtom);

  const [state, setState] = useState<EventCreationState>(initialState);

  const defaultCalendar = useMemo(() => {
    // New events go to a calendar the user can write to: the primary one if
    // it's shown, else the first shown writable one.
    const writable = visibleCalendars.filter((v) =>
      canWriteCalendar(
        allCalendars.find(
          (c) => c.accountId === v.accountId && c.calendar.id === v.calendarId
        )?.calendar.accessRole
      )
    );
    if (writable.length === 0) {
      return null;
    }
    const primaryCalendar = allCalendars.find(
      (c) =>
        c.calendar.primary &&
        writable.some(
          (v) => v.accountId === c.accountId && v.calendarId === c.calendar.id
        )
    );
    if (primaryCalendar) {
      return {
        accountId: primaryCalendar.accountId,
        calendarId: primaryCalendar.calendar.id,
      };
    }
    return writable[0];
  }, [visibleCalendars, allCalendars]);

  const onSlotHover = useCallback((dateTime: Temporal.ZonedDateTime) => {
    setState((prev) => {
      // Don't update hover if we're in creation mode. Mouse moves within the
      // same 15-minute slot snap to the same time; keep state so nothing re-renders.
      if (prev.isCreating || prev.hoverDateTime?.equals(dateTime)) {
        return prev;
      }
      return { ...prev, hoverDateTime: dateTime };
    });
  }, []);

  const onSlotLeave = useCallback(() => {
    setState((prev) => {
      if (prev.isCreating) {
        return prev;
      }
      return { ...prev, hoverDateTime: null };
    });
  }, []);

  // Document listeners keep creation dragging across events that cover slot elements.
  const startDateTimeRef = useRef<Temporal.ZonedDateTime | null>(null);
  const documentListenerCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => documentListenerCleanupRef.current?.(), []);

  const onSlotDragMove = useCallback((dateTime: Temporal.ZonedDateTime) => {
    setState((prev) => {
      if (!(prev.isCreating && prev.startDateTime)) {
        return prev;
      }
      const dragStartDateTime = startDateTimeRef.current ?? prev.startDateTime;
      if (!isSameDay(dragStartDateTime, dateTime)) {
        return prev;
      }

      // The range covers every slot dragged over, including the pressed one.
      const order = Temporal.ZonedDateTime.compare(dateTime, dragStartDateTime);
      if (order === 0) {
        // Still on the pressed slot: what a click would create.
        return {
          ...prev,
          endDateTime: dragStartDateTime.add({
            minutes: DEFAULT_EVENT_DURATION_MINUTES,
          }),
          startDateTime: dragStartDateTime,
        };
      }
      if (order > 0) {
        return {
          ...prev,
          endDateTime: dateTime.add({ minutes: MINUTES_STEP }),
          startDateTime: dragStartDateTime,
        };
      }
      return {
        ...prev,
        endDateTime: dragStartDateTime.add({ minutes: MINUTES_STEP }),
        startDateTime: dateTime,
      };
    });
  }, []);

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

  // Start at the pressed slot. The move and up listeners go on the document
  // so the drag continues while the cursor crosses existing events.
  const onSlotMouseDown = useCallback(
    (dateTime: Temporal.ZonedDateTime) => {
      // Without a calendar to write to, the chooser still opens for a task;
      // its Event tab says why there's no event.
      documentListenerCleanupRef.current?.();

      startDateTimeRef.current = dateTime;

      setState((prev) => ({
        ...prev,
        accountId: defaultCalendar?.accountId ?? null,
        calendarId: defaultCalendar?.calendarId ?? null,
        endDateTime: dateTime.add({
          minutes: DEFAULT_EVENT_DURATION_MINUTES,
        }),
        hoverDateTime: null,
        isCreating: true,
        showPopover: false,
        startDateTime: dateTime,
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
          Math.floor(minutesFromTop / MINUTES_STEP) * MINUTES_STEP;
        const clampedMinutes = Math.min(
          Math.max(snappedMinutes, 0),
          24 * 60 - MINUTES_STEP
        );

        const snapped = Temporal.ZonedDateTime.from({
          day: start.day,
          hour: Math.floor(clampedMinutes / 60),
          minute: clampedMinutes % 60,
          month: start.month,
          timeZone: start.timeZoneId,
          year: start.year,
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

  const createAt = useCallback(
    (start: Temporal.ZonedDateTime): CreateAtResult => {
      if (!defaultCalendar && isLoadingCalendars) {
        return "waiting";
      }
      documentListenerCleanupRef.current?.();
      startDateTimeRef.current = start;
      setState((prev) => ({
        ...prev,
        accountId: defaultCalendar?.accountId ?? null,
        calendarId: defaultCalendar?.calendarId ?? null,
        endDateTime: start.add({ minutes: DEFAULT_EVENT_DURATION_MINUTES }),
        hoverDateTime: null,
        isCreating: false,
        showPopover: true,
        startDateTime: start,
      }));
      return "created";
    },
    [defaultCalendar, isLoadingCalendars]
  );

  const cancelCreation = useCallback(() => {
    documentListenerCleanupRef.current?.();
    setState(initialState);
  }, []);

  const closePopover = useCallback(() => {
    documentListenerCleanupRef.current?.();
    setState(initialState);
  }, []);

  const setPreviewElement = useCallback((element: HTMLDivElement | null) => {
    setState((prev) => ({ ...prev, previewElement: element }));
  }, []);

  const actions: EventCreationActions = useMemo(
    () => ({
      cancelCreation,
      closePopover,
      createAt,
      onSlotDragMove,
      onSlotHover,
      onSlotLeave,
      onSlotMouseDown,
      onSlotMouseUp,
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
      createAt,
      setPreviewElement,
    ]
  );

  const popoverTimes = useMemo(() => {
    if (!(state.startDateTime && state.endDateTime)) {
      return null;
    }
    const start = state.startDateTime;
    let end = state.endDateTime;

    const duration = end.since(start).total({ unit: "minutes" });
    if (duration < MINUTES_STEP) {
      end = start.add({ minutes: DEFAULT_EVENT_DURATION_MINUTES });
    }

    return { end, start };
  }, [state.startDateTime, state.endDateTime]);

  // Why the chooser can't make an event (it can still make a task).
  let eventUnavailableReason: string | null = null;
  if (!defaultCalendar) {
    eventUnavailableReason =
      googleAccounts.length === 0
        ? "Connect a Google calendar in Settings to create events."
        : "Show a calendar you can edit from the Calendars menu to create events.";
  }

  return useMemo(
    () => ({
      actions,
      eventUnavailableReason,
      popoverTimes,
      state,
    }),
    [state, actions, eventUnavailableReason, popoverTimes]
  );
}
