"use client";

import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import {
  chosenScope,
  eventDeleteScopeState,
  RECURRENCE_SCOPE_OPTIONS,
  refuseSave,
  type SaveRefusals,
  SCOPE_DIALOG_COPY,
  seriesCutUnsure,
  seriesRefusalOf,
} from "@kompose/state/recurrence-scope-options";
import { atom, useAtom, useAtomValue } from "jotai";
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
 * so a refusal or failure couldn't be said.
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
  const timeZone = useAtomValue(timezoneAtom);
  const { deleteEvent } = useGoogleEventMutations();
  const series = useRecurringEventMaster({
    accountId,
    calendarId,
    enabled: open,
    event,
  });
  const [pick, setPick] = useState(target.defaultScope);
  /** The scopes the server refused for this delete, and why. */
  const [refused, setRefused] = useState<SaveRefusals | null>(null);
  const state = eventDeleteScopeState({
    cutUnsure: seriesCutUnsure(event, series.data, timeZone),
    refused,
    seriesRuleFailed: series.ruleFailed,
    seriesRuleLoaded: Boolean(event.recurrence?.length || series.ruleReady),
  });
  // The delete runs quiet, so a failure other than a refusal is said here.
  const failed =
    deleteEvent.isError && seriesRefusalOf(deleteEvent.error) === null;
  // The one asked for, or the nearest available while it's off.
  const scope = chosenScope(pick, pick, state.disabled);

  const confirm = async () => {
    try {
      await deleteEvent.mutateAsync({
        accountId,
        calendarId,
        eventId: event.id,
        failureMessage: DELETE_FAILURE_MESSAGE,
        quiet: true,
        scope,
      });
    } catch (error) {
      // A refused scope turns off, led by why. Rethrown, so the dialog
      // stays open.
      const refusal = seriesRefusalOf(error);
      if (refusal) {
        setRefused((before) => refuseSave(before, scope, refusal));
      }
      throw error;
    }
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
      title={SCOPE_DIALOG_COPY.deleteEvent.title}
      value={scope}
    />
  );
}
