import { describe, expect, test } from "bun:test";
import {
  type EventEditCommand,
  type EventEditOperation,
  type EventEditOperationAction,
  eventEditOperationReducer as reduce,
  runEventEditOperation,
} from "./event-edit-operation";

const source = { accountId: "account", calendarId: "source", eventId: "event" };
const save = {
  isRecurring: true,
  kind: "save",
  move: { ...source, destinationCalendarId: "destination" },
  update: {
    ...source,
    event: {
      id: "event",
      summary: "Edited",
      start: { dateTime: "2026-11-06T10:00:00Z" },
      end: { dateTime: "2026-11-06T11:00:00Z" },
    },
  },
} satisfies EventEditCommand;
const deletion = {
  isRecurring: false,
  kind: "delete",
  variables: source,
} satisfies EventEditCommand;

function prepare(
  command: EventEditCommand = save,
  confirm = true
): EventEditOperation {
  return reduce(
    { kind: "idle" },
    {
      command,
      confirm,
      id: 1,
      scope: "all",
      type: "prepare",
    }
  );
}

function harness(initial: EventEditOperation) {
  let state = initial;
  return {
    runningOperations: new Set<number>(),
    dispatch: (action: EventEditOperationAction) => {
      state = reduce(state, action);
    },
    get state() {
      return state;
    },
  };
}

function running(state: EventEditOperation) {
  if (state.kind !== "running") {
    throw new Error(`Expected running, got ${state.kind}`);
  }
  return state;
}

const unexpectedMutation = () =>
  Promise.reject(new Error("Unexpected mutation"));

describe("event edit operations", () => {
  test("dismissal discards the command and stale actions cannot touch a newer confirmation", () => {
    const confirming = prepare();
    const idle = reduce(confirming, { id: 1, type: "dismiss" });
    expect(idle).toEqual({ kind: "idle" });
    const next = reduce(idle, {
      command: deletion,
      confirm: true,
      id: 2,
      scope: "this",
      type: "prepare",
    });
    for (const action of [
      { id: 1, type: "run" },
      { id: 1, step: "update", type: "succeeded" },
      {
        id: 1,
        step: "update",
        type: "failed",
      },
      { id: 1, type: "dismiss" },
    ] satisfies EventEditOperationAction[]) {
      expect(reduce(next, action)).toBe(next);
    }
  });

  test("only one confirmation can exist, and running cannot be reconfirmed, dismissed or re-scoped", () => {
    const confirming = prepare();
    expect(
      reduce(confirming, {
        command: deletion,
        confirm: true,
        id: 2,
        scope: "this",
        type: "prepare",
      })
    ).toBe(confirming);
    const active = reduce(confirming, { id: 1, type: "run" });
    for (const action of [
      { id: 1, type: "run" },
      { id: 1, type: "dismiss" },
      { id: 1, scope: "following", type: "scope" },
    ] satisfies EventEditOperationAction[]) {
      expect(reduce(active, action)).toBe(active);
    }
  });

  test("a recurring move always confirms the entire series", () => {
    const state = reduce(
      { kind: "idle" },
      {
        command: save,
        confirm: true,
        id: 1,
        scope: "this",
        type: "prepare",
      }
    );
    expect(state).toMatchObject({ kind: "confirming", scope: "all" });
    expect(
      reduce(state, { id: 1, scope: "following", type: "scope" })
    ).toMatchObject({ scope: "all" });
  });

  test("a failed move retries only the move with the original scope and destination", async () => {
    const flow = harness(prepare(save, false));
    const calls: string[] = [];
    let failMove = true;
    const mutations = {
      delete: unexpectedMutation,
      move: (variables: { scope: string; destinationCalendarId: string }) => {
        calls.push(
          `move:${variables.scope}:${variables.destinationCalendarId}`
        );
        return failMove
          ? Promise.reject(new Error("move failed"))
          : Promise.resolve(null);
      },
      update: (variables: { recurrenceScope?: string }) => {
        calls.push(`update:${variables.recurrenceScope}`);
        return Promise.resolve(null);
      },
    };
    await runEventEditOperation(
      running(flow.state),
      mutations,
      flow.dispatch,
      flow.runningOperations
    );
    expect(flow.state).toMatchObject({ kind: "failed", retryStep: "move" });
    failMove = false;
    flow.dispatch({ id: 1, type: "run" });
    await runEventEditOperation(
      running(flow.state),
      mutations,
      flow.dispatch,
      flow.runningOperations
    );
    expect(calls).toEqual([
      "update:all",
      "move:all:destination",
      "move:all:destination",
    ]);
    expect(flow.state).toEqual({ kind: "idle" });
  });

  test("a failed update does not start the move; retry starts at update", async () => {
    const flow = harness(prepare(save, false));
    await runEventEditOperation(
      running(flow.state),
      {
        delete: unexpectedMutation,
        move: unexpectedMutation,
        update: () => Promise.reject(new Error("update failed")),
      },
      flow.dispatch,
      flow.runningOperations
    );
    expect(flow.state).toMatchObject({ kind: "failed", retryStep: "update" });
    flow.dispatch({ id: 1, type: "run" });
    expect(flow.state).toMatchObject({
      kind: "running",
      step: "update",
      scope: "all",
    });
  });

  test("calendar-only moves never call update", async () => {
    const flow = harness(prepare({ ...save, update: null }, false));
    const calls: string[] = [];
    await runEventEditOperation(
      running(flow.state),
      {
        delete: unexpectedMutation,
        move: () => {
          calls.push("move");
          return Promise.resolve(null);
        },
        update: unexpectedMutation,
      },
      flow.dispatch,
      flow.runningOperations
    );
    expect(calls).toEqual(["move"]);
    expect(flow.state).toEqual({ kind: "idle" });
  });

  test("a completed update without a move closes the operation", async () => {
    const flow = harness(prepare({ ...save, move: null }, false));
    await runEventEditOperation(
      running(flow.state),
      {
        delete: unexpectedMutation,
        move: unexpectedMutation,
        update: () => Promise.resolve(null),
      },
      flow.dispatch,
      flow.runningOperations
    );
    expect(flow.state).toEqual({ kind: "idle" });
  });

  test("delete stays running until settled and failed deletes can retry", async () => {
    const flow = harness(reduce(prepare(deletion), { id: 1, type: "run" }));
    const deferred = Promise.withResolvers<null>();
    const pending = runEventEditOperation(
      running(flow.state),
      {
        delete: () => deferred.promise,
        move: unexpectedMutation,
        update: unexpectedMutation,
      },
      flow.dispatch,
      flow.runningOperations
    );
    expect(flow.state).toMatchObject({ kind: "running", step: "delete" });
    deferred.reject(new Error("delete failed"));
    await pending;
    expect(flow.state).toMatchObject({ kind: "failed", retryStep: "delete" });
    flow.dispatch({ id: 1, type: "run" });
    await runEventEditOperation(
      running(flow.state),
      {
        delete: () => Promise.resolve(null),
        move: unexpectedMutation,
        update: unexpectedMutation,
      },
      flow.dispatch,
      flow.runningOperations
    );
    expect(flow.state).toEqual({ kind: "idle" });
  });

  test("duplicate confirmations send only one mutation while the request is pending", async () => {
    const flow = harness(reduce(prepare(deletion), { id: 1, type: "run" }));
    const deferred = Promise.withResolvers<null>();
    let deletes = 0;
    const mutations = {
      delete: () => {
        deletes += 1;
        return deferred.promise;
      },
      move: unexpectedMutation,
      update: unexpectedMutation,
    };
    const snapshot = running(flow.state);
    const first = runEventEditOperation(
      snapshot,
      mutations,
      flow.dispatch,
      flow.runningOperations
    );
    await runEventEditOperation(
      snapshot,
      mutations,
      flow.dispatch,
      flow.runningOperations
    );
    expect(deletes).toBe(1);
    expect(flow.state).toMatchObject({ kind: "running" });
    deferred.resolve(null);
    await first;
    expect(flow.state).toEqual({ kind: "idle" });
    expect(flow.runningOperations.size).toBe(0);
  });

  test("a duplicate update completion cannot skip an in-flight move", () => {
    const active = reduce(prepare(save, false), {
      id: 1,
      step: "update",
      type: "succeeded",
    });
    expect(active).toMatchObject({ kind: "running", step: "move" });
    expect(reduce(active, { id: 1, step: "update", type: "succeeded" })).toBe(
      active
    );
  });
});
