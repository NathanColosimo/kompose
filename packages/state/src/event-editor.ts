import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import type { Temporal } from "temporal-polyfill";
import type { CalendarIdentifier } from "./atoms/visible-calendars";
import { isRecurringGoogleEvent } from "./google-event-recurrence";

interface EventDraftBase {
  allDay: boolean;
  calendar: CalendarIdentifier;
  colorId?: string | null;
  conferenceData?: GoogleEvent["conferenceData"] | null;
  description: string;
  endDate: Temporal.PlainDate;
  endTime: Temporal.PlainTime | null;
  location: string;
  recurrence: string[];
  startDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime | null;
  summary: string;
}

export interface CreateEventDraft extends EventDraftBase {
  mode: "create";
}

export interface EditEventDraft extends EventDraftBase {
  eventId: string;
  mode: "edit";
  sourceCalendar: CalendarIdentifier;
  sourceEvent: GoogleEvent;
}

export type EventDraft = CreateEventDraft | EditEventDraft;

export function isRecurringEventDraft(draft: EditEventDraft): boolean {
  return (
    isRecurringGoogleEvent({
      event: draft.sourceEvent,
      masterRecurrence: draft.recurrence,
    }) || Boolean(draft.sourceEvent.originalStartTime)
  );
}

interface Session {
  sessionId: string;
}

type EditOperation = {
  draft: EditEventDraft;
  scope: RecurrenceScope;
} & (
  | { action: "save"; phase: "update" | "move" }
  | { action: "delete"; phase: "delete" }
);

type Submission =
  | (EditOperation & { returnTo: "editor" | "scope" })
  | {
      action: "create";
      draft: CreateEventDraft;
      phase: "create";
      returnTo: "editor";
      scope: "this";
    };

export type EventEditorState =
  | { status: "closed" }
  | (Session & { status: "editing"; draft: EventDraft; failed?: boolean })
  | (Session & EditOperation & { status: "scope"; failed?: boolean })
  | (Session & Submission & { status: "submitting"; opId: string });

export type EventEditorAction =
  | (Session & { type: "open"; draft: EventDraft })
  | (Session & { type: "close" | "cancel-scope" })
  | (Session & {
      type: "request-scope";
      draft: EditEventDraft;
      action: "save" | "delete";
      scope: RecurrenceScope;
    })
  | (Session & { type: "select-scope"; scope: RecurrenceScope })
  | (Session & { type: "submit"; opId: string; draft?: EventDraft })
  | (Session & { type: "updated"; opId: string; event: GoogleEvent })
  | (Session & { type: "succeeded" | "failed"; opId: string });

export function eventEditorReducer(
  state: EventEditorState,
  event: EventEditorAction
): EventEditorState {
  if (event.type === "open") {
    return {
      draft: event.draft,
      sessionId: event.sessionId,
      status: "editing",
    };
  }
  if (state.status === "closed" || state.sessionId !== event.sessionId) {
    return state;
  }
  const { sessionId } = state;
  switch (event.type) {
    case "close":
      if (
        state.status === "scope" ||
        (state.status === "submitting" && state.returnTo === "scope")
      ) {
        return state;
      }
      return { status: "closed" };
    case "cancel-scope":
      if (state.status !== "scope") {
        return state;
      }
      // Once the update succeeds, only the remaining move can be retried.
      if (state.phase === "move") {
        return { status: "closed" };
      }
      return { draft: state.draft, sessionId, status: "editing" };
    case "request-scope":
      if (state.status !== "editing") {
        return state;
      }
      return {
        ...(event.action === "save"
          ? { action: "save" as const, phase: "update" as const }
          : { action: "delete" as const, phase: "delete" as const }),
        draft: event.draft,
        scope: event.scope,
        sessionId,
        status: "scope",
      };
    case "select-scope":
      return selectScope(state, event.scope);
    case "submit":
      return beginSubmission(state, event);
    case "updated":
    case "succeeded":
    case "failed":
      if (state.status !== "submitting" || state.opId !== event.opId) {
        return state;
      }
      return completeSubmission(state, event);
    default:
      return event satisfies never;
  }
}

function completeSubmission(
  state: Extract<EventEditorState, { status: "submitting" }>,
  event: Extract<
    EventEditorAction,
    { type: "updated" | "succeeded" | "failed" }
  >
): EventEditorState {
  switch (event.type) {
    case "updated":
      if (state.phase !== "update") {
        return state;
      }
      return {
        ...state,
        draft: {
          ...state.draft,
          eventId: event.event.id,
          sourceEvent: event.event,
        },
        phase: "move",
      };
    case "succeeded":
      return { status: "closed" };
    case "failed":
      if (
        state.action !== "create" &&
        (state.returnTo === "scope" || state.phase === "move")
      ) {
        const { opId, returnTo, status, ...snapshot } = state;
        return { ...snapshot, failed: true, status: "scope" };
      }
      return {
        draft: state.draft,
        failed: true,
        sessionId: state.sessionId,
        status: "editing",
      };
    default:
      return event satisfies never;
  }
}

function selectScope(
  state: Exclude<EventEditorState, { status: "closed" }>,
  scope: RecurrenceScope
): EventEditorState {
  if (
    state.status !== "scope" ||
    state.phase === "move" ||
    !isRecurringEventDraft(state.draft)
  ) {
    return state;
  }
  const moving =
    state.action === "save" &&
    state.draft.calendar.calendarId !== state.draft.sourceCalendar.calendarId;
  if (moving && scope !== "all") {
    return state;
  }
  return { ...state, scope };
}

function beginSubmission(
  state: Exclude<EventEditorState, { status: "closed" }>,
  event: Extract<EventEditorAction, { type: "submit" }>
): EventEditorState {
  if (state.status === "submitting") {
    return state;
  }
  if (state.status === "scope") {
    const { failed, status, ...operation } = state;
    return {
      ...operation,
      opId: event.opId,
      returnTo: "scope",
      status: "submitting",
    };
  }
  const draft = event.draft;
  if (!draft) {
    return state;
  }
  return {
    ...(draft.mode === "create"
      ? { action: "create" as const, draft, phase: "create" as const }
      : { action: "save" as const, draft, phase: "update" as const }),
    opId: event.opId,
    returnTo: "editor",
    scope: "this",
    sessionId: state.sessionId,
    status: "submitting",
  };
}
