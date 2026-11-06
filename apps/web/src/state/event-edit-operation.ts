import {
  type EventEditOperation,
  type EventEditOperationAction,
  eventEditOperationReducer,
} from "@kompose/state/event-edit-operation";
import { atomWithReducer } from "jotai/utils";

export const eventEditOperationAtom = atomWithReducer<
  EventEditOperation,
  EventEditOperationAction
>({ kind: "idle" }, eventEditOperationReducer);
