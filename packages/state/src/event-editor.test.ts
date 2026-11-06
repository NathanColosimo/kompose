import { expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  type EventDraft,
  type EventEditorState,
  eventEditorReducer,
} from "./event-editor";

const draft: EventDraft = {
  allDay: false,
  calendar: { accountId: "account", calendarId: "source" },
  description: "",
  endDate: Temporal.PlainDate.from("2026-11-06"),
  endTime: Temporal.PlainTime.from("10:00"),
  location: "",
  mode: "create",
  recurrence: [],
  startDate: Temporal.PlainDate.from("2026-11-06"),
  startTime: Temporal.PlainTime.from("09:00"),
  summary: "Typed title",
};

function open(sessionId: string): EventEditorState {
  return eventEditorReducer(
    { status: "closed" },
    {
      draft,
      sessionId,
      type: "open",
    }
  );
}

test("a dismissed save cannot close or restore a different editor", () => {
  for (const dismissalFinished of [false, true]) {
    let state = eventEditorReducer(open("A"), {
      draft,
      opId: "save-A",
      sessionId: "A",
      type: "submit",
    });
    state = eventEditorReducer(state, { sessionId: "A", type: "dismiss" });
    if (dismissalFinished) {
      state = eventEditorReducer(state, { sessionId: "A", type: "close" });
    }
    state = eventEditorReducer(state, { draft, sessionId: "B", type: "open" });
    const editorB = state;
    for (const type of ["succeeded", "failed"] as const) {
      state = eventEditorReducer(state, {
        opId: "save-A",
        sessionId: "A",
        type,
      });
      expect(state).toBe(editorB);
    }
  }
});

test("submission is single-flight and a failed create preserves the submitted draft", () => {
  const submitted = {
    ...draft,
    summary: "New title",
    location: "Typed location",
  };
  const saving = eventEditorReducer(open("A"), {
    draft: submitted,
    opId: "first",
    sessionId: "A",
    type: "submit",
  });
  expect(
    eventEditorReducer(saving, {
      draft: submitted,
      opId: "duplicate",
      sessionId: "A",
      type: "submit",
    })
  ).toBe(saving);
  const failed = eventEditorReducer(saving, {
    opId: "first",
    sessionId: "A",
    type: "failed",
  });
  expect(failed).toMatchObject({
    draft: submitted,
    failed: true,
    status: "editing",
  });
  const retry = eventEditorReducer(failed, {
    draft: submitted,
    opId: "retry",
    sessionId: "A",
    type: "submit",
  });
  expect(
    eventEditorReducer(retry, {
      opId: "first",
      sessionId: "A",
      type: "succeeded",
    })
  ).toBe(retry);
});

const editDraft = {
  ...draft,
  calendar: { accountId: "account", calendarId: "destination" },
  eventId: "occurrence",
  mode: "edit" as const,
  sourceCalendar: draft.calendar,
  sourceEvent: {
    end: { dateTime: "2026-11-06T10:00:00Z" },
    id: "occurrence",
    recurringEventId: "master",
    start: { dateTime: "2026-11-06T09:00:00Z" },
  },
};

function requestScope(action: "save" | "delete") {
  return eventEditorReducer(open("A"), {
    action,
    draft: editDraft,
    scope: "all",
    sessionId: "A",
    type: "request-scope",
  });
}

test("direct save completions after dismissal starts cannot restore a hidden editor", () => {
  for (const dismissAfterUpdate of [false, true]) {
    for (const type of ["succeeded", "failed"] as const) {
      let state = eventEditorReducer(open("A"), {
        draft: editDraft,
        opId: "save",
        sessionId: "A",
        type: "submit",
      });
      if (!dismissAfterUpdate) {
        state = eventEditorReducer(state, { sessionId: "A", type: "dismiss" });
      }
      state = eventEditorReducer(state, {
        event: { ...editDraft.sourceEvent, id: "updated-event" },
        opId: "save",
        sessionId: "A",
        type: "updated",
      });
      if (dismissAfterUpdate) {
        state = eventEditorReducer(state, { sessionId: "A", type: "dismiss" });
      }
      state = eventEditorReducer(state, { opId: "save", sessionId: "A", type });
      expect(state).toEqual({ status: "closed" });
      expect(
        eventEditorReducer(state, { sessionId: "A", type: "close" })
      ).toEqual({ status: "closed" });
    }
  }
});

test("create and update failures during dismissal close the session", () => {
  for (const submitted of [draft, editDraft]) {
    let state = eventEditorReducer(open("A"), {
      draft: submitted,
      opId: "save",
      sessionId: "A",
      type: "submit",
    });
    state = eventEditorReducer(state, { sessionId: "A", type: "dismiss" });
    expect(
      eventEditorReducer(state, {
        opId: "save",
        sessionId: "A",
        type: "failed",
      })
    ).toEqual({ status: "closed" });
  }
});

test("scope cancellation restores the submitted edits, and failure retains the confirmation", () => {
  for (const action of ["save", "delete"] as const) {
    const scoped = requestScope(action);
    expect(
      eventEditorReducer(scoped, {
        sessionId: "A",
        type: "cancel-scope",
      })
    ).toMatchObject({ draft: editDraft, status: "editing" });
    const submitting = eventEditorReducer(scoped, {
      opId: "operation",
      sessionId: "A",
      type: "submit",
    });
    expect(
      eventEditorReducer(submitting, {
        sessionId: "A",
        type: "cancel-scope",
      })
    ).toBe(submitting);
    expect(
      eventEditorReducer(submitting, {
        opId: "operation",
        sessionId: "A",
        type: "failed",
      })
    ).toMatchObject({
      action,
      draft: editDraft,
      failed: true,
      scope: "all",
      status: "scope",
    });
  }
});

test("a failed move retries only the move, using the event returned by the successful update", () => {
  for (const initial of [requestScope("save"), open("A")]) {
    let state = eventEditorReducer(initial, {
      draft: editDraft,
      opId: "update",
      sessionId: "A",
      type: "submit",
    });
    state = eventEditorReducer(state, {
      event: {
        ...editDraft.sourceEvent,
        id: "master",
        recurrence: ["RRULE:FREQ=DAILY"],
      },
      opId: "update",
      sessionId: "A",
      type: "updated",
    });
    state = eventEditorReducer(state, {
      opId: "update",
      sessionId: "A",
      type: "failed",
    });
    expect(state).toMatchObject({
      draft: { eventId: "master", summary: "Typed title" },
      failed: true,
      phase: "move",
      status: "scope",
    });
    const retry = eventEditorReducer(state, {
      opId: "move-retry",
      sessionId: "A",
      type: "submit",
    });
    expect(retry).toMatchObject({ phase: "move", status: "submitting" });
    expect(
      eventEditorReducer(retry, {
        event: editDraft.sourceEvent,
        opId: "update",
        sessionId: "A",
        type: "updated",
      })
    ).toBe(retry);
    expect(
      eventEditorReducer(retry, {
        opId: "move-retry",
        sessionId: "A",
        type: "succeeded",
      })
    ).toEqual({ status: "closed" });
  }
});

test("old sheet and dialog callbacks cannot dismiss or submit a new session", () => {
  const editorB = open("B");
  expect(eventEditorReducer(editorB, { sessionId: "A", type: "dismiss" })).toBe(
    editorB
  );
  expect(eventEditorReducer(editorB, { sessionId: "A", type: "close" })).toBe(
    editorB
  );
  expect(
    eventEditorReducer(editorB, {
      draft,
      opId: "stale-submit",
      sessionId: "A",
      type: "submit",
    })
  ).toBe(editorB);
  expect(
    eventEditorReducer(editorB, {
      action: "delete",
      draft: editDraft,
      scope: "all",
      sessionId: "A",
      type: "request-scope",
    })
  ).toBe(editorB);
});

test("a scope prompt ignores late sheet dismissal and locks recurring moves to all", () => {
  const scoped = requestScope("save");
  expect(eventEditorReducer(scoped, { sessionId: "A", type: "dismiss" })).toBe(
    scoped
  );
  expect(eventEditorReducer(scoped, { sessionId: "A", type: "close" })).toBe(
    scoped
  );
  expect(
    eventEditorReducer(scoped, {
      scope: "this",
      sessionId: "A",
      type: "select-scope",
    })
  ).toBe(scoped);
  const submitting = eventEditorReducer(scoped, {
    opId: "save",
    sessionId: "A",
    type: "submit",
  });
  expect(
    eventEditorReducer(submitting, { sessionId: "A", type: "close" })
  ).toBe(submitting);
  expect(
    eventEditorReducer(submitting, {
      scope: "following",
      sessionId: "A",
      type: "select-scope",
    })
  ).toBe(submitting);
});
