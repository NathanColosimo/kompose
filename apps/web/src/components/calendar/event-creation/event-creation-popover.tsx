"use client";

import {
  EVENT_CREATE_FAILURE_MESSAGE,
  TASK_CREATE_FAILURE_MESSAGE,
} from "@kompose/state/held-save";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { SaveFailure } from "@/components/ui/held-fieldset";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  pickerDateToTemporal,
  zonedDateTimeToDate,
} from "@/lib/temporal-utils";
import {
  TaskEditForm,
  type TaskFormValues,
} from "../../task-form/task-edit-popover";
import {
  type CloseSaveRequest,
  EventEditForm,
} from "../events/event-edit-popover";
import type { CalendarCreateFormInterop } from "./create-form-shared";
import { useEventCreation } from "./use-event-creation";

type CreationMode = "event" | "task";
function buildInitialSharedFields(start: Date, end: Date) {
  const durationMinutes = Math.max(
    15,
    Math.round((end.getTime() - start.getTime()) / 60_000)
  );

  return {
    description: "",
    durationMinutes,
    startDate: start,
    startTime: `${String(start.getHours()).padStart(2, "0")}:${String(
      start.getMinutes()
    ).padStart(2, "0")}`,
    title: "",
  };
}

/** See documents/event-popover.md for shared fields and tab-switch behavior. */
export function EventCreationPopover() {
  const { state, actions, popoverTimes } = useEventCreation();
  const { createEvent } = useGoogleEventMutations();
  const [mode, setMode] = useState<CreationMode>("event");
  const eventCloseSaveRequestRef = useRef<(() => CloseSaveRequest) | null>(
    null
  );
  const taskSubmitRef = useRef<(() => boolean | Promise<boolean>) | null>(null);
  const eventInteropRef = useRef<CalendarCreateFormInterop | null>(null);
  const taskInteropRef = useRef<CalendarCreateFormInterop | null>(null);

  const startDate = useMemo(
    () => (popoverTimes ? zonedDateTimeToDate(popoverTimes.start) : new Date()),
    [popoverTimes]
  );

  const endDate = useMemo(
    () => (popoverTimes ? zonedDateTimeToDate(popoverTimes.end) : new Date()),
    [popoverTimes]
  );

  const initialSharedFields = useMemo(
    () => buildInitialSharedFields(startDate, endDate),
    [endDate, startDate]
  );

  const initialTaskValues = useMemo<Partial<TaskFormValues>>(
    () => ({
      description: initialSharedFields.description,
      dueDate: null,
      durationMinutes: initialSharedFields.durationMinutes,
      links: [],
      recurrence: null,
      startDate: initialSharedFields.startDate
        ? pickerDateToTemporal(initialSharedFields.startDate)
        : null,
      startTime: initialSharedFields.startTime
        ? Temporal.PlainTime.from(initialSharedFields.startTime)
        : null,
      tagIds: [],
      title: initialSharedFields.title,
    }),
    [initialSharedFields]
  );

  const handleModeChange = (nextMode: string) => {
    if (nextMode !== "event" && nextMode !== "task") {
      return;
    }
    if (nextMode === mode) {
      return;
    }
    // A failed create's message belongs to the other form.
    setFailure(null);

    const currentInterop =
      mode === "event" ? eventInteropRef.current : taskInteropRef.current;
    const nextInterop =
      nextMode === "event" ? eventInteropRef.current : taskInteropRef.current;
    const sharedFields = currentInterop?.getSharedFields();

    if (sharedFields) {
      nextInterop?.applySharedFields(sharedFields);
    }

    setMode(nextMode);
  };

  // The popover stays open ("Saving…") until the create succeeds, so a
  // failed one keeps the draft. Escape and outside clicks wait too.
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  /** Why the last create failed, shown beside Save until the next one. */
  const [failure, setFailure] = useState<string | null>(null);
  // A failure belongs to its draft: a new one starts clean.
  useEffect(() => {
    if (!state.showPopover) {
      setFailure(null);
    }
  }, [state.showPopover]);
  const holdForCreate = useCallback(
    (created: Promise<boolean>, failureMessage: string) => {
      savingRef.current = true;
      setIsSaving(true);
      setFailure(null);
      created.then((saved) => {
        savingRef.current = false;
        setIsSaving(false);
        if (saved) {
          actions.closePopover();
        } else {
          setFailure(failureMessage);
        }
      });
    },
    [actions]
  );

  const handleCancel = useCallback(() => {
    if (!savingRef.current) {
      actions.closePopover();
    }
  }, [actions]);

  const handleSave = useCallback(() => {
    if (savingRef.current) {
      return;
    }
    if (mode === "task") {
      const result = taskSubmitRef.current?.() ?? true;
      if (result === true) {
        actions.closePopover();
      } else if (result !== false) {
        holdForCreate(result, TASK_CREATE_FAILURE_MESSAGE);
      }
      return;
    }

    const request = eventCloseSaveRequestRef.current?.() ?? { type: "none" };
    if (request.type === "invalid") {
      // The form says why ("Ends before it starts.").
      return;
    }
    if (request.type !== "create") {
      actions.closePopover();
      return;
    }
    holdForCreate(
      createEvent
        .mutateAsync({
          ...request.payload,
          failureMessage: EVENT_CREATE_FAILURE_MESSAGE,
          // Shown beside Save; a toast could land on the popover.
          quiet: true,
        })
        .then(
          () => true,
          () => false
        ),
      EVENT_CREATE_FAILURE_MESSAGE
    );
  }, [actions, createEvent, holdForCreate, mode]);

  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    { enabled: state.showPopover, enableOnFormTags: true },
    [handleSave, state.showPopover]
  );

  if (
    !(state.showPopover && popoverTimes && state.accountId && state.calendarId)
  ) {
    return null;
  }

  return (
    <Popover open={state.showPopover}>
      <PopoverTrigger asChild>
        <span
          style={{
            height: state.previewElement?.getBoundingClientRect().height ?? 20,
            left: state.previewElement?.getBoundingClientRect().right ?? 0,
            pointerEvents: "none",
            position: "fixed",
            top: state.previewElement?.getBoundingClientRect().top ?? 0,
            width: "1px",
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Fits the space Radix measured, scrolling a long draft rather than
        // running off screen, as the edit popover does.
        className="max-h-(--radix-popover-content-available-height) w-[420px] overflow-y-auto p-4"
        collisionPadding={8}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        side="right"
      >
        {/* Read-only while the create runs: a change typed then wouldn't
            be saved. */}
        <fieldset className="min-w-0" disabled={isSaving}>
          <Tabs className="gap-3" onValueChange={handleModeChange} value={mode}>
            <div className="flex items-center gap-2">
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="event">Event</TabsTrigger>
                <TabsTrigger value="task">Task</TabsTrigger>
              </TabsList>
              <div className="ml-auto flex gap-2">
                <Button
                  disabled={isSaving}
                  onClick={handleCancel}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  disabled={isSaving}
                  onClick={handleSave}
                  size="sm"
                  type="button"
                >
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
            {/* Beside Save, where the click was: the form can be long. */}
            <SaveFailure className="text-right" message={failure} />

            {/* Keep both forms mounted so tab switches can transfer values in-place. */}
            <TabsContent
              className="mt-0 data-[state=inactive]:hidden"
              forceMount
              value="event"
            >
              <EventEditForm
                accountId={state.accountId}
                calendarId={state.calendarId}
                closeSaveRequestRef={eventCloseSaveRequestRef}
                createInteropRef={eventInteropRef}
                end={endDate}
                isSaving={isSaving}
                mode="create"
                onDelete={() => undefined}
                onSave={handleSave}
                open={state.showPopover}
                start={startDate}
              />
            </TabsContent>

            <TabsContent
              className="mt-0 data-[state=inactive]:hidden"
              forceMount
              value="task"
            >
              <TaskEditForm
                createInteropRef={taskInteropRef}
                externalSaving={isSaving}
                initialValues={initialTaskValues}
                mode="create"
                onClose={handleCancel}
                open={state.showPopover}
                submitRef={taskSubmitRef}
              />
            </TabsContent>
          </Tabs>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
