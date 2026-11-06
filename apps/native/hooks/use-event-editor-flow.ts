import {
  type EditEventDraft,
  type EventDraft,
  type EventEditorAction,
  type EventEditorState,
  eventEditorReducer,
  isRecurringEventDraft,
} from "@kompose/state/event-editor";
import { getDefaultRecurrenceScopeForEvent } from "@kompose/state/google-event-recurrence";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useMoveGoogleEventMutation } from "@kompose/state/hooks/use-move-google-event-mutation";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import { useCallback, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";

function buildEventPayload(draft: EventDraft, timeZone: string) {
  let startPayload: { date?: string; dateTime?: string; timeZone?: string };
  let endPayload: { date?: string; dateTime?: string; timeZone?: string };

  if (draft.allDay) {
    startPayload = { date: draft.startDate.toString() };
    endPayload = { date: draft.endDate.add({ days: 1 }).toString() };
  } else {
    const startZdt = draft.startDate.toZonedDateTime({
      plainTime: draft.startTime ?? Temporal.PlainTime.from("09:00"),
      timeZone,
    });
    const endZdt = draft.endDate.toZonedDateTime({
      plainTime: draft.endTime ?? Temporal.PlainTime.from("10:00"),
      timeZone,
    });
    startPayload = {
      dateTime: startZdt.toInstant().toString(),
      timeZone,
    };
    endPayload = {
      dateTime: endZdt.toInstant().toString(),
      timeZone,
    };
  }

  return {
    colorId: draft.colorId ?? undefined,
    conferenceData: draft.conferenceData ?? undefined,
    description: draft.description.trim() || undefined,
    end: endPayload,
    location: draft.location.trim() || undefined,
    recurrence: draft.recurrence.length > 0 ? draft.recurrence : undefined,
    start: startPayload,
    summary: draft.summary.trim(),
  };
}

type Submitting = Extract<EventEditorState, { status: "submitting" }>;

export function useEventEditorFlow(timeZone: string) {
  const { createEvent, updateEvent, deleteEvent } = useGoogleEventMutations();
  const moveEvent = useMoveGoogleEventMutation();
  const [state, setState] = useState<EventEditorState>({ status: "closed" });
  // Apply transitions synchronously so two taps before React renders cannot
  // both start a mutation. This is the same reducer that supplies rendered state.
  const current = useRef(state);
  const dispatch = useCallback((event: EventEditorAction) => {
    const next = eventEditorReducer(current.current, event);
    current.current = next;
    setState(next);
    return next;
  }, []);

  const draft = state.status === "closed" ? null : state.draft;
  const editingDraft = draft?.mode === "edit" ? draft : null;
  const master = useRecurringEventMaster({
    accountId: editingDraft?.sourceCalendar.accountId ?? "",
    calendarId: editingDraft?.sourceCalendar.calendarId ?? "",
    event: editingDraft?.sourceEvent ?? null,
  });
  const masterRecurrence = master.data?.recurrence;

  const open = useCallback(
    (newDraft: EventDraft) => {
      dispatch({ draft: newDraft, sessionId: uuidv7(), type: "open" });
    },
    [dispatch]
  );

  const run = async (operation: Submitting) => {
    const { sessionId, opId, scope } = operation;
    try {
      if (operation.action === "create") {
        await createEvent.mutateAsync({
          accountId: operation.draft.calendar.accountId,
          calendarId: operation.draft.calendar.calendarId,
          event: buildEventPayload(operation.draft, timeZone),
        });
      } else if (operation.action === "delete") {
        await deleteEvent.mutateAsync({
          accountId: operation.draft.sourceCalendar.accountId,
          calendarId: operation.draft.sourceCalendar.calendarId,
          eventId: operation.draft.eventId,
          scope,
        });
      } else {
        const savedDraft = operation.draft;
        const { sourceCalendar } = savedDraft;
        let eventId = savedDraft.eventId;
        const isMoving =
          savedDraft.calendar.calendarId !== sourceCalendar.calendarId;
        if (operation.phase === "update") {
          const payload = buildEventPayload(savedDraft, timeZone);
          const updated = await updateEvent.mutateAsync({
            accountId: sourceCalendar.accountId,
            calendarId: sourceCalendar.calendarId,
            event: {
              ...savedDraft.sourceEvent,
              ...payload,
              end: { ...savedDraft.sourceEvent.end, ...payload.end },
              start: { ...savedDraft.sourceEvent.start, ...payload.start },
            },
            eventId,
            recurrenceScope: scope,
          });
          if (isMoving) {
            eventId = updated.id;
            dispatch({ event: updated, opId, sessionId, type: "updated" });
          }
        }
        if (isMoving) {
          await moveEvent.mutateAsync({
            accountId: sourceCalendar.accountId,
            calendarId: sourceCalendar.calendarId,
            destinationCalendarId: savedDraft.calendar.calendarId,
            eventId,
            scope,
          });
        }
      }
      dispatch({ opId, sessionId, type: "succeeded" });
    } catch {
      // Mutation hooks report the API error. Keep the snapshot and any successful
      // update checkpoint so the user can retry without repeating that update.
      dispatch({ opId, sessionId, type: "failed" });
    }
  };

  const submit = (sessionId: string, submittedDraft?: EventDraft) => {
    const opId = uuidv7();
    const next = dispatch({
      draft: submittedDraft,
      opId,
      sessionId,
      type: "submit",
    });
    if (next.status === "submitting" && next.opId === opId) {
      return run(next);
    }
  };

  const requestScope = (
    sessionId: string,
    submittedDraft: EditEventDraft,
    action: "save" | "delete"
  ) => {
    const moving =
      action === "save" &&
      submittedDraft.calendar.calendarId !==
        submittedDraft.sourceCalendar.calendarId;
    dispatch({
      action,
      draft: submittedDraft,
      scope: moving
        ? "all"
        : getDefaultRecurrenceScopeForEvent({
            event: submittedDraft.sourceEvent,
            masterRecurrence: submittedDraft.recurrence.length
              ? submittedDraft.recurrence
              : masterRecurrence,
          }),
      sessionId,
      type: "request-scope",
    });
  };

  const save = (sessionId: string, submittedDraft: EventDraft) => {
    if (!submittedDraft.summary.trim()) {
      return;
    }
    if (
      submittedDraft.mode === "edit" &&
      isRecurringEventDraft(submittedDraft)
    ) {
      requestScope(sessionId, submittedDraft, "save");
      return;
    }
    return submit(sessionId, submittedDraft);
  };

  return {
    dispatch,
    masterRecurrence,
    open,
    save,
    state,
    submit,
    requestDelete: (sessionId: string, submittedDraft: EditEventDraft) =>
      requestScope(sessionId, submittedDraft, "delete"),
  };
}
