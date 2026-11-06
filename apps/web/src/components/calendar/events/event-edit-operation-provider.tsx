"use client";

import type { RecurrenceScope } from "@kompose/google-cal/schema";
import {
  type EventEditCommand,
  type EventEditOperation,
  type EventEditOperationAction,
  runEventEditOperation,
} from "@kompose/state/event-edit-operation";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useMoveGoogleEventMutation } from "@kompose/state/hooks/use-move-google-event-mutation";
import { useAtom, useStore } from "jotai";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
} from "react";
import { RecurrenceScopeDialog } from "@/components/recurrence-scope-dialog";
import { eventEditOperationAtom } from "@/state/event-edit-operation";

const EventEditOperationContext = createContext<{
  busy: boolean;
  prepareOperation: (
    command: EventEditCommand,
    scope: RecurrenceScope,
    confirm: boolean
  ) => void;
} | null>(null);

export function useEventEditOperation() {
  const context = useContext(EventEditOperationContext);
  if (!context) {
    throw new Error("Event editor requires EventEditOperationProvider");
  }
  return context;
}

export function EventEditOperationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { updateEvent, deleteEvent } = useGoogleEventMutations();
  const moveEvent = useMoveGoogleEventMutation();
  const store = useStore();
  const [operation, dispatchOperation] = useAtom(eventEditOperationAtom);
  const nextOperationId = useRef(0);
  const runningOperations = useRef(new Set<number>());

  const runOperation = useCallback(
    (running: Extract<EventEditOperation, { kind: "running" }>) =>
      runEventEditOperation(
        running,
        {
          delete: deleteEvent.mutateAsync,
          move: moveEvent.mutateAsync,
          update: updateEvent.mutateAsync,
        },
        dispatchOperation,
        runningOperations.current
      ),
    [
      deleteEvent.mutateAsync,
      dispatchOperation,
      moveEvent.mutateAsync,
      updateEvent.mutateAsync,
    ]
  );

  const prepareOperation = useCallback(
    (command: EventEditCommand, scope: RecurrenceScope, confirm: boolean) => {
      if (
        store.get(eventEditOperationAtom).kind !== "idle" ||
        runningOperations.current.size > 0
      ) {
        return;
      }
      nextOperationId.current += 1;
      const action = {
        command,
        confirm,
        id: nextOperationId.current,
        scope,
        type: "prepare" as const,
      };
      dispatchOperation(action);
      const next = store.get(eventEditOperationAtom);
      if (next.kind === "running") {
        runOperation(next);
      }
    },
    [dispatchOperation, store, runOperation]
  );

  const confirmOperation = useCallback(() => {
    const currentOperation = store.get(eventEditOperationAtom);
    if (
      currentOperation.kind !== "confirming" &&
      currentOperation.kind !== "failed"
    ) {
      return;
    }
    const action = { id: currentOperation.id, type: "run" as const };
    dispatchOperation(action);
    const next = store.get(eventEditOperationAtom);
    if (next.kind === "running") {
      return runOperation(next);
    }
  }, [dispatchOperation, store, runOperation]);

  return (
    <EventEditOperationContext.Provider
      value={{ busy: operation.kind !== "idle", prepareOperation }}
    >
      {children}
      <EventOperationDialog
        dispatch={dispatchOperation}
        onConfirm={confirmOperation}
        operation={operation}
      />
    </EventEditOperationContext.Provider>
  );
}

function EventOperationDialog({
  operation,
  dispatch,
  onConfirm,
}: {
  operation: EventEditOperation;
  dispatch: Dispatch<EventEditOperationAction>;
  onConfirm: () => void | Promise<void>;
}) {
  if (operation.kind === "idle") {
    return null;
  }
  let confirmLabel = operation.command.kind === "delete" ? "Delete" : "Save";
  if (operation.kind === "failed") {
    confirmLabel = "Retry";
  }
  let description = "Choose how broadly to apply your changes.";
  if (!operation.command.isRecurring) {
    description = "Save your changes to this event.";
  }
  if (operation.command.kind === "delete") {
    description = "This action cannot be undone.";
  } else if (operation.command.move && operation.command.isRecurring) {
    description =
      "Moving to a different calendar applies to all events in the series.";
  }
  return (
    <RecurrenceScopeDialog
      confirmLabel={confirmLabel}
      description={description}
      disabledScopes={
        operation.command.kind === "save" && operation.command.move
          ? { following: true, this: true }
          : undefined
      }
      error={
        operation.kind === "failed"
          ? `Could not ${operation.retryStep} the event. ${operation.retryStep === "move" ? "Any saved event changes are kept. Retry will only move the event." : "Retry to try this step again."}`
          : undefined
      }
      onConfirm={onConfirm}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dispatch({ id: operation.id, type: "dismiss" });
        }
      }}
      onValueChange={(scope) =>
        dispatch({ id: operation.id, scope, type: "scope" })
      }
      open
      options={operation.command.isRecurring ? undefined : []}
      pending={operation.kind === "running"}
      scopeDisabled={operation.kind !== "confirming"}
      title={
        operation.command.kind === "delete"
          ? "Delete event?"
          : "Save event changes"
      }
      value={operation.scope}
    />
  );
}
