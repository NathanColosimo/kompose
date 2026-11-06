import type {
  DeleteEventInput,
  MoveEventInput,
} from "@kompose/api/routers/google-cal/contract";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import type { UpdateGoogleEventInput } from "./hooks/use-google-event-mutations";

export type EventEditCommand =
  | {
      kind: "save";
      isRecurring: boolean;
      update: UpdateGoogleEventInput | null;
      move: Omit<MoveEventInput, "scope"> | null;
    }
  | {
      kind: "delete";
      isRecurring: boolean;
      variables: Omit<DeleteEventInput, "scope">;
    };

type OperationStep = "update" | "move" | "delete";
interface OperationContext {
  command: EventEditCommand;
  id: number;
  scope: RecurrenceScope;
}

export type EventEditOperation =
  | { kind: "idle" }
  | (OperationContext & { kind: "confirming" })
  | (OperationContext & { kind: "running"; step: OperationStep })
  | (OperationContext & {
      kind: "failed";
      retryStep: OperationStep;
    });

export type EventEditOperationAction =
  | (OperationContext & { type: "prepare"; confirm: boolean })
  | { type: "scope"; id: number; scope: RecurrenceScope }
  | { type: "run"; id: number }
  | { type: "dismiss"; id: number }
  | { type: "succeeded"; id: number; step: "move" | "delete" }
  | { type: "succeeded"; id: number; step: "update"; eventId: string }
  | { type: "failed"; id: number; step: OperationStep };

function operationScope(
  command: EventEditCommand,
  scope: RecurrenceScope
): RecurrenceScope {
  return command.kind === "save" && command.move && command.isRecurring
    ? "all"
    : scope;
}

function firstStep(command: EventEditCommand): OperationStep {
  if (command.kind === "delete") {
    return "delete";
  }
  return command.update ? "update" : "move";
}

export function eventEditOperationReducer(
  state: EventEditOperation,
  action: EventEditOperationAction
): EventEditOperation {
  if (action.type === "prepare") {
    if (state.kind !== "idle") {
      return state;
    }
    const context = {
      command: action.command,
      id: action.id,
      scope: operationScope(action.command, action.scope),
    };
    return action.confirm
      ? { ...context, kind: "confirming" }
      : { ...context, kind: "running", step: firstStep(action.command) };
  }
  if (state.kind === "idle" || state.id !== action.id) {
    return state;
  }
  switch (action.type) {
    case "dismiss":
      // A running mutation cannot be cancelled on the server.
      return state.kind === "running" ? state : { kind: "idle" };
    case "scope":
      return state.kind === "confirming"
        ? { ...state, scope: operationScope(state.command, action.scope) }
        : state;
    case "run":
      if (state.kind !== "confirming" && state.kind !== "failed") {
        return state;
      }
      return {
        command: state.command,
        id: state.id,
        kind: "running",
        scope: state.scope,
        step:
          state.kind === "failed" ? state.retryStep : firstStep(state.command),
      };
    case "failed":
      return state.kind === "running" && state.step === action.step
        ? {
            command: state.command,
            id: state.id,
            kind: "failed",
            retryStep: action.step,
            scope: state.scope,
          }
        : state;
    case "succeeded":
      return completeOperationStep(state, action);
    default:
      return action satisfies never;
  }
}

function completeOperationStep(
  state: EventEditOperation,
  action: Extract<EventEditOperationAction, { type: "succeeded" }>
): EventEditOperation {
  const { step } = action;
  if (state.kind !== "running" || state.step !== step) {
    return state;
  }
  if (
    step === "update" &&
    state.command.kind === "save" &&
    state.command.move
  ) {
    return {
      ...state,
      command: {
        ...state.command,
        move: { ...state.command.move, eventId: action.eventId },
      },
      step: "move",
    };
  }
  return { kind: "idle" };
}

/** Runs an immutable command snapshot, resuming at the recorded failed step. */
export async function runEventEditOperation(
  operation: Extract<EventEditOperation, { kind: "running" }>,
  mutations: {
    update: (
      variables: UpdateGoogleEventInput
    ) => Promise<Pick<GoogleEvent, "id">>;
    move: (variables: MoveEventInput) => Promise<unknown>;
    delete: (variables: DeleteEventInput) => Promise<unknown>;
  },
  dispatch: (action: EventEditOperationAction) => void,
  runningOperations: Set<number>
) {
  const { command, id, scope } = operation;
  // Claim before awaiting, including repeated confirms before React renders.
  if (runningOperations.has(id)) {
    return;
  }
  runningOperations.add(id);
  let step = operation.step;
  let move = command.kind === "save" ? command.move : null;
  try {
    if (command.kind === "delete") {
      await mutations.delete({ ...command.variables, scope });
      dispatch({ id, step: "delete", type: "succeeded" });
      return;
    }
    if (step === "update" && command.update) {
      const updated = await mutations.update({
        ...command.update,
        recurrenceScope: scope,
      });
      if (move) {
        move = { ...move, eventId: updated.id };
      }
      dispatch({ id, step: "update", eventId: updated.id, type: "succeeded" });
      step = "move";
    }
    if (move) {
      await mutations.move({ ...move, scope });
      dispatch({ id, step: "move", type: "succeeded" });
    }
  } catch {
    dispatch({ id, step, type: "failed" });
  } finally {
    runningOperations.delete(id);
  }
}
