"use client";

import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useCallback, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
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

/**
 * EventCreationPopover keeps the existing event create flow, but now lets
 * users swap the inline form to a task create form without leaving the slot.
 */
export function EventCreationPopover() {
  const { state, actions, popoverTimes } = useEventCreation();
  const { createEvent } = useGoogleEventMutations();
  const [mode, setMode] = useState<CreationMode>("event");
  const eventCloseSaveRequestRef = useRef<(() => CloseSaveRequest) | null>(
    null
  );
  const taskSubmitRef = useRef<(() => boolean) | null>(null);
  const eventInteropRef = useRef<CalendarCreateFormInterop | null>(null);
  const taskInteropRef = useRef<CalendarCreateFormInterop | null>(null);

  // Convert ZonedDateTime to Date for the popover
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

  const handleCancel = useCallback(() => {
    actions.closePopover();
  }, [actions]);

  const handleSave = useCallback(() => {
    if (mode === "task") {
      const shouldClose = taskSubmitRef.current?.() ?? true;
      if (!shouldClose) {
        return;
      }
      actions.closePopover();
      return;
    }

    const request = eventCloseSaveRequestRef.current?.() ?? { type: "none" };

    actions.closePopover();

    if (request.type === "create") {
      createEvent.mutate(request.payload);
    }
  }, [actions, createEvent, mode]);

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
        className="w-[420px] p-4"
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
        <Tabs className="gap-3" onValueChange={handleModeChange} value={mode}>
          <div className="flex items-center gap-2">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="event">Event</TabsTrigger>
              <TabsTrigger value="task">Task</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex gap-2">
              <Button
                onClick={handleCancel}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button onClick={handleSave} size="sm" type="button">
                Save
              </Button>
            </div>
          </div>

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
              initialValues={initialTaskValues}
              mode="create"
              onClose={handleCancel}
              open={state.showPopover}
              submitRef={taskSubmitRef}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
