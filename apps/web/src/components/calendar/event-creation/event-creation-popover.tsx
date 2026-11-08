"use client";

import {
  EVENT_CREATE_FAILURE_MESSAGE,
  TASK_CREATE_FAILURE_MESSAGE,
} from "@kompose/state/held-save";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { isNarrowViewportAtom } from "@/state/sidebar";
import {
  SaveButtonLabel,
  TaskCreateForm,
  type TaskFormValues,
  useHeldSave,
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
  const { state, popoverTimes } = useEventCreation();
  // The type the user last picked; the chooser reopens on it.
  const [mode, setMode] = useState<CreationMode>("event");

  if (!(state.showPopover && popoverTimes)) {
    return null;
  }
  // Mounted per opening, so each draft starts clean.
  return (
    <CreationChooser
      mode={mode}
      onModeChange={setMode}
      popoverTimes={popoverTimes}
    />
  );
}

function CreationChooser({
  mode,
  onModeChange,
  popoverTimes,
}: {
  mode: CreationMode;
  onModeChange: (mode: CreationMode) => void;
  popoverTimes: NonNullable<
    ReturnType<typeof useEventCreation>["popoverTimes"]
  >;
}) {
  const { state, actions, eventUnavailableReason } = useEventCreation();
  const { createEvent } = useGoogleEventMutations();
  const isNarrow = useAtomValue(isNarrowViewportAtom);
  // With no calendar to write to on opening, it shows Task (the Event tab
  // says why) without changing the user's pick. A calendar that loads
  // later doesn't switch tabs.
  const [forcedTask, setForcedTask] = useState(
    () => eventUnavailableReason !== null
  );
  const shownMode: CreationMode = forcedTask ? "task" : mode;
  const eventCloseSaveRequestRef = useRef<(() => CloseSaveRequest) | null>(
    null
  );
  const taskSubmitRef = useRef<(() => boolean | Promise<boolean>) | null>(null);
  const eventInteropRef = useRef<CalendarCreateFormInterop | null>(null);
  const taskInteropRef = useRef<CalendarCreateFormInterop | null>(null);

  const startDate = useMemo(
    () => zonedDateTimeToDate(popoverTimes.start),
    [popoverTimes]
  );

  const endDate = useMemo(
    () => zonedDateTimeToDate(popoverTimes.end),
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
    if (nextMode === shownMode) {
      return;
    }
    // A failed create's message belongs to the other form.
    setFailure(null);

    const currentInterop =
      shownMode === "event" ? eventInteropRef.current : taskInteropRef.current;
    const nextInterop =
      nextMode === "event" ? eventInteropRef.current : taskInteropRef.current;
    const sharedFields = currentInterop?.getSharedFields();

    if (sharedFields) {
      nextInterop?.applySharedFields(sharedFields);
    }

    setForcedTask(false);
    onModeChange(nextMode);
  };

  // The popover stays open ("Saving…") until the create succeeds, so a
  // failed one keeps the draft. Escape and outside clicks wait too.
  const contentRef = useRef<HTMLDivElement>(null);
  const hold = useHeldSave({
    editorRef: contentRef,
    onClose: actions.closePopover,
  });
  const isSaving = hold.saving !== null;
  const eventBlocked = shownMode === "event" && eventUnavailableReason !== null;

  /** Why the last create failed, shown beside Save until the next one. */
  const [failure, setFailure] = useState<string | null>(null);
  const { holdOpen } = hold;
  const holdForCreate = useCallback(
    (created: Promise<boolean>, failureMessage: string) => {
      setFailure(null);
      holdOpen(
        "save",
        created.then((saved) => {
          if (!saved) {
            setFailure(failureMessage);
          }
          return saved;
        })
      );
    },
    [holdOpen]
  );

  const handleCancel = useCallback(() => {
    if (!isSaving) {
      actions.closePopover();
    }
  }, [actions, isSaving]);

  const handleSave = useCallback(() => {
    // Cmd+Enter too: the blocked Event tab has nothing to save, and closing
    // would drop the draft.
    if (isSaving || eventBlocked) {
      return;
    }
    if (shownMode === "task") {
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
  }, [actions, createEvent, eventBlocked, holdForCreate, isSaving, shownMode]);

  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    { enableOnFormTags: true },
    [handleSave]
  );

  return (
    <Popover open>
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
        className="max-h-(--radix-popover-content-available-height) w-[420px] max-w-[calc(100vw-16px)] overflow-y-auto p-4"
        collisionPadding={8}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          handleCancel();
        }}
        // Typing goes to the title, the first thing to fill in.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current
            ?.querySelector<HTMLInputElement>(
              '[role="tabpanel"][data-state="active"] input'
            )
            // Popper hasn't placed the content yet; scrolling to it now
            // would jump the page.
            ?.focus({ preventScroll: true });
        }}
        ref={contentRef}
        // A phone has no room beside the slot, and Radix only slides a side
        // placement up or down, so the chooser opens below it instead.
        side={isNarrow ? "bottom" : "right"}
      >
        {/* Read-only while the create runs: a change typed then wouldn't
            be saved. */}
        <fieldset className="min-w-0" disabled={isSaving}>
          <Tabs
            className="gap-3"
            onValueChange={handleModeChange}
            value={shownMode}
          >
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
                <Button
                  disabled={eventBlocked}
                  onClick={handleSave}
                  size="sm"
                  type="button"
                >
                  <SaveButtonLabel saving={isSaving} />
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
              {state.accountId && state.calendarId ? (
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
                  open
                  start={startDate}
                />
              ) : (
                <p className="py-6 text-center text-muted-foreground text-sm">
                  {eventUnavailableReason}
                </p>
              )}
            </TabsContent>

            <TabsContent
              className="mt-0 data-[state=inactive]:hidden"
              forceMount
              value="task"
            >
              <TaskCreateForm
                createInteropRef={taskInteropRef}
                initialValues={initialTaskValues}
                saving={isSaving}
                submitRef={taskSubmitRef}
              />
            </TabsContent>
          </Tabs>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
