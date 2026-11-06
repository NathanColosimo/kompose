import type { DesktopTaskSelection } from "@kompose/desktop";

export interface PopupState {
  desired: "hidden" | "shown";
  kind: "loading" | "ready";
}

export function reducePopup(
  state: PopupState,
  event: "toggle" | "hide" | "ready"
): PopupState {
  switch (event) {
    case "toggle":
      return {
        ...state,
        desired: state.desired === "shown" ? "hidden" : "shown",
      };
    case "hide":
      return { ...state, desired: "hidden" };
    case "ready":
      return { ...state, kind: "ready" };
    default:
      throw new Error(`Unknown popup event: ${event satisfies never}`);
  }
}

export interface TaskDeliveryState {
  pending: DesktopTaskSelection | null;
  ready: boolean;
}

export type TaskDeliveryEvent =
  | { kind: "request"; selection: DesktopTaskSelection }
  | { kind: "subscription"; ready: boolean }
  | { kind: "navigate" };

export function reduceTaskDelivery(
  state: TaskDeliveryState,
  event: TaskDeliveryEvent
): { deliver: DesktopTaskSelection | null; state: TaskDeliveryState } {
  let next: TaskDeliveryState;
  switch (event.kind) {
    case "request":
      next = { ...state, pending: event.selection };
      break;
    case "subscription":
      next = { ...state, ready: event.ready };
      break;
    case "navigate":
      next = { ...state, ready: false };
      break;
    default:
      throw new Error(`Unknown task delivery event: ${event satisfies never}`);
  }
  if (next.ready && next.pending) {
    return { deliver: next.pending, state: { ...next, pending: null } };
  }
  return { deliver: null, state: next };
}
