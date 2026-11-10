"use client";

import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import {
  chosenScope,
  eventDeleteScopeState,
  RECURRENCE_SCOPE_OPTIONS,
  SCOPE_DIALOG_COPY,
} from "@kompose/state/recurrence-scope-options";
import { atom, useAtom } from "jotai";
import { useState } from "react";
import { RecurrenceScopeDialog } from "@/components/recurrence-scope-dialog";

const DELETE_FAILURE_MESSAGE = "Couldn't delete it. Try again.";

/** A recurring event's delete, waiting for its scope. */
export interface RecurringDelete {
  accountId: string;
  calendarId: string;
  defaultScope: RecurrenceScope;
  event: GoogleEvent;
}

/**
 * The recurring delete being asked for, and whether its dialog is open.
 * It stays after the dialog closes, so the dialog's words hold as it
 * fades; `id` starts each ask fresh.
 */
export const recurringDeleteAtom = atom<{
  id: number;
  open: boolean;
  target: RecurringDelete;
} | null>(null);

/**
 * The scope dialog for deleting a recurring event, mounted once with the
 * calendar rather than in the event's block: a delete takes the event off
 * the calendar as it starts, which would take a dialog inside it along,
 * so a failure couldn't be said.
 */
export function RecurringDeleteDialog() {
  const [ask, setAsk] = useAtom(recurringDeleteAtom);
  if (!ask) {
    return null;
  }
  return (
    <DeleteScopeDialog
      key={ask.id}
      onOpenChange={(open) => setAsk({ ...ask, open })}
      open={ask.open}
      target={ask.target}
    />
  );
}

function DeleteScopeDialog({
  onOpenChange,
  open,
  target,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  target: RecurringDelete;
}) {
  const { accountId, calendarId, event } = target;
  const { deleteEvent } = useGoogleEventMutations();
  const series = useRecurringEventMaster({
    accountId,
    calendarId,
    enabled: open,
    event,
  });
  const [pick, setPick] = useState(target.defaultScope);
  const state = eventDeleteScopeState({
    seriesRuleFailed: series.ruleFailed,
    seriesRuleLoaded: Boolean(event.recurrence?.length || series.ruleReady),
  });
  // The delete runs quiet, so a failure is said here.
  const failed = deleteEvent.isError;
  // The one asked for, or the nearest available while it's off.
  const scope = chosenScope(pick, pick, state.disabled);

  // A failure rejects, so the dialog stays open.
  const confirm = async () => {
    await deleteEvent.mutateAsync({
      accountId,
      calendarId,
      eventId: event.id,
      failureMessage: DELETE_FAILURE_MESSAGE,
      quiet: true,
      scope,
    });
  };

  return (
    <RecurrenceScopeDialog
      confirmLabel="Delete"
      description={
        failed
          ? `${DELETE_FAILURE_MESSAGE} ${state.description}`
          : state.description
      }
      disabledScopes={state.disabled}
      onConfirm={confirm}
      onOpenChange={onOpenChange}
      onValueChange={setPick}
      open={open}
      options={RECURRENCE_SCOPE_OPTIONS}
      pendingLabel="Deleting…"
      title={SCOPE_DIALOG_COPY.deleteEvent.title}
      value={scope}
    />
  );
}
