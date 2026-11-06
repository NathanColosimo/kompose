"use client";

import type { CreateEventInput } from "@kompose/api/routers/google-cal/contract";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@kompose/state/atoms/google-colors";
import { googleCalendarsDataAtom } from "@kompose/state/atoms/google-data";
import {
  type EventEditCommand,
  type EventEditOperation,
  type EventEditOperationAction,
  eventEditOperationReducer,
  runEventEditOperation,
} from "@kompose/state/event-edit-operation";
import {
  type RecurrenceDraft,
  resolveEventRecurrence,
} from "@kompose/state/event-recurrence-draft";
import {
  dateToUntilRule,
  untilRuleToDate,
} from "@kompose/state/google-event-recurrence";
import {
  type UpdateGoogleEventInput,
  useGoogleEventMutations,
} from "@kompose/state/hooks/use-google-event-mutations";
import { useLocationSearch } from "@kompose/state/hooks/use-location-search";
import { useMoveGoogleEventMutation } from "@kompose/state/hooks/use-move-google-event-mutation";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import { getMapsSearchUrl } from "@kompose/state/locations";
import {
  buildGoogleMeetConferenceData,
  extractMeetingLink,
  type MeetingLink,
} from "@kompose/state/meeting";
import { useAtomValue } from "jotai";
import {
  CalendarIcon,
  Check,
  Lock,
  MapPin,
  Palette,
  Repeat,
  Timer,
  Trash2,
  Video,
} from "lucide-react";
import {
  type Dispatch,
  type ReactElement,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { RecurrenceScopeDialog } from "@/components/recurrence-scope-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import {
  formatPlainDate,
  formatTimeString,
  pickerDateToTemporal,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import type {
  CalendarCreateFormInterop,
  CalendarCreateSharedFields,
} from "../event-creation/create-form-shared";
import {
  buildRecurrenceRule,
  buildTemporalPayload,
  type Frequency,
  parseRecurrence,
  type RecurrenceEnd,
  WEEKDAYS,
} from "./event-edit-utils";

interface EventEditPopoverProps {
  accountId: string;
  align?: "start" | "center" | "end";
  calendarId: string;
  children: ReactElement;
  end: Date;
  event?: GoogleEvent;
  /** Whether the popover is in create or edit mode. Defaults based on event presence. */
  mode?: "create" | "edit";
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  readOnly?: boolean;
  readOnlyReason?: string | null;
  side?: "top" | "right" | "bottom" | "left";
  start: Date;
}

interface EventFormValues {
  allDay: boolean;
  colorId?: string;
  conferenceData: GoogleEvent["conferenceData"] | null;
  description: string;
  endDate: Date | null;
  endTime: string;
  location: string;
  recurrenceDraft: RecurrenceDraft;
  selectedAccountId: string;
  selectedCalendarId: string;
  startDate: Date | null;
  startTime: string;
  summary: string;
}

interface RecurrenceEditorValues {
  byDay: string[];
  count: number;
  endType: RecurrenceEnd["type"];
  freq: Frequency;
  /** Stored as RRULE UNTIL value (e.g. `YYYYMMDDT...Z`). Empty means unset. */
  untilRule: string;
}

function buildRecurrenceEnd(values: RecurrenceEditorValues): RecurrenceEnd {
  if (values.endType === "until" && values.untilRule) {
    return { date: values.untilRule, type: "until" };
  }
  if (values.endType === "count" && values.count > 0) {
    return { count: values.count, type: "count" };
  }
  return { type: "none" };
}

export type CloseSaveRequest =
  | { type: "none" }
  | { type: "blocked" }
  | {
      type: "save";
      command: Extract<EventEditCommand, { kind: "save" }>;
      defaultScope: RecurrenceScope;
    }
  | {
      type: "create";
      payload: CreateEventInput;
    };

function parseTimeString(
  value: string
): { hours: number; minutes: number } | null {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return { hours, minutes };
}

function buildSharedEndFields(
  startDate: Date | null,
  startTime: string,
  durationMinutes: number
): Pick<EventFormValues, "endDate" | "endTime"> {
  const normalizedDuration =
    Number.isFinite(durationMinutes) && durationMinutes > 0
      ? Math.round(durationMinutes)
      : 30;
  const parsedStartTime = parseTimeString(startTime);

  if (!(startDate && parsedStartTime)) {
    return {
      endDate: startDate,
      endTime: startTime,
    };
  }

  const nextEndDate = new Date(startDate);
  nextEndDate.setHours(parsedStartTime.hours, parsedStartTime.minutes, 0, 0);
  nextEndDate.setMinutes(nextEndDate.getMinutes() + normalizedDuration);

  return {
    endDate: nextEndDate,
    endTime: formatTimeString(nextEndDate),
  };
}

function getSharedFieldsFromEventValues(
  values: EventFormValues
): CalendarCreateSharedFields {
  const startDate = values.startDate ?? values.endDate ?? null;
  const parsedStartTime = parseTimeString(values.startTime);
  const parsedEndTime = parseTimeString(values.endTime);
  let durationMinutes = 30;

  if (startDate && parsedStartTime && parsedEndTime) {
    const startDateTime = new Date(startDate);
    startDateTime.setHours(
      parsedStartTime.hours,
      parsedStartTime.minutes,
      0,
      0
    );

    const endBaseDate = values.endDate ?? startDate;
    const endDateTime = new Date(endBaseDate);
    endDateTime.setHours(parsedEndTime.hours, parsedEndTime.minutes, 0, 0);

    const computedDuration = Math.round(
      (endDateTime.getTime() - startDateTime.getTime()) / 60_000
    );
    if (computedDuration > 0) {
      durationMinutes = computedDuration;
    }
  }

  return {
    description: values.description,
    durationMinutes,
    startDate,
    startTime: values.startTime,
    title: values.summary,
  };
}

function RecurrenceEditor({
  visible,
  recurrenceRule,
  onChange,
}: {
  visible: boolean;
  recurrenceRule?: string;
  onChange: (rule: string | null) => void;
}) {
  const parsedRecurrence = useMemo(
    () => parseRecurrence(recurrenceRule),
    [recurrenceRule]
  );

  const values = useMemo<RecurrenceEditorValues>(() => {
    const endType = parsedRecurrence.end.type;
    return {
      byDay: parsedRecurrence.byDay,
      count: endType === "count" ? parsedRecurrence.end.count : 5,
      endType,
      freq: parsedRecurrence.freq,
      untilRule: endType === "until" ? parsedRecurrence.end.date : "",
    };
  }, [parsedRecurrence.byDay, parsedRecurrence.end, parsedRecurrence.freq]);

  const emitChanges = (changes: Partial<RecurrenceEditorValues>) => {
    const nextValues = { ...values, ...changes };
    const end = buildRecurrenceEnd(nextValues);
    const nextRule = buildRecurrenceRule(
      nextValues.freq,
      nextValues.byDay,
      end
    );
    const normalizedNext = nextRule ?? null;
    if (normalizedNext === (recurrenceRule ?? null)) {
      return;
    }
    onChange(nextRule);
  };

  const untilDate = useMemo(
    () => (values.untilRule ? untilRuleToDate(values.untilRule) : null),
    [values.untilRule]
  );

  if (!visible) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Repeat className="size-4" />
          <span>Recurrence</span>
        </div>
        {recurrenceRule ? (
          <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">
            {recurrenceRule}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Repeat</Label>
        <Select
          onValueChange={(v) => {
            const nextFreq = v as Frequency;
            emitChanges({
              byDay: nextFreq === "WEEKLY" ? values.byDay : [],
              freq: nextFreq,
            });
          }}
          value={values.freq}
        >
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="DAILY">Daily</SelectItem>
            <SelectItem value="WEEKLY">Weekly</SelectItem>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {values.freq === "WEEKLY" && (
        <div className="space-y-2">
          <span className="text-muted-foreground text-xs">On days</span>
          <div className="flex gap-1">
            {WEEKDAYS.map((day) => {
              const active = values.byDay.includes(day.value);
              return (
                <Button
                  className={cn(
                    "size-8 rounded-full p-0 text-xs",
                    active &&
                      "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                  key={day.value}
                  onClick={() => {
                    const current = values.byDay;
                    const next = active
                      ? current.filter((d) => d !== day.value)
                      : [...current, day.value];
                    emitChanges({ byDay: next });
                  }}
                  size="icon"
                  type="button"
                  variant={active ? "default" : "outline"}
                >
                  {day.label.slice(0, 2)}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <span className="text-muted-foreground text-xs">Ends</span>
        <div className="space-y-2">
          <Button
            className="h-8 w-full justify-start text-xs"
            onClick={() => {
              emitChanges({ endType: "none", untilRule: "" });
            }}
            size="sm"
            type="button"
            variant={values.endType === "none" ? "default" : "outline"}
          >
            Never
          </Button>

          <div className="flex items-center gap-2">
            <Button
              className="h-8 shrink-0 text-xs"
              onClick={() => {
                const fallback =
                  values.untilRule ||
                  dateToUntilRule(new Date()) ||
                  `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}T000000Z`;
                emitChanges({ endType: "until", untilRule: fallback });
              }}
              size="sm"
              type="button"
              variant={values.endType === "until" ? "default" : "outline"}
            >
              On
            </Button>
            {values.endType === "until" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    className="h-7 gap-1.5 px-2 text-xs"
                    variant="outline"
                  >
                    <CalendarIcon className="size-3" />
                    {untilDate
                      ? formatPlainDate(pickerDateToTemporal(untilDate), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    onSelect={(date) => {
                      if (!date) {
                        emitChanges({ endType: "none", untilRule: "" });
                        return;
                      }
                      const rule = dateToUntilRule(date);
                      if (rule) {
                        emitChanges({ untilRule: rule });
                      }
                    }}
                    selected={untilDate ?? undefined}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              className="h-8 shrink-0 text-xs"
              onClick={() => {
                const nextCount =
                  Number.isFinite(values.count) && values.count > 0
                    ? values.count
                    : 5;
                emitChanges({ count: nextCount, endType: "count" });
              }}
              size="sm"
              type="button"
              variant={values.endType === "count" ? "default" : "outline"}
            >
              After
            </Button>
            {values.endType === "count" && (
              <>
                <Input
                  className="h-7 w-16 px-2 text-xs"
                  min={1}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(parsed) && parsed > 0) {
                      emitChanges({ count: parsed });
                    }
                  }}
                  type="number"
                  value={values.count}
                />
                <span className="text-muted-foreground text-xs">times</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
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

/** See documents/event-popover.md for save, recurrence scope, and calendar move behavior. */
export function EventEditPopover({
  event,
  accountId,
  calendarId,
  start,
  end,
  children,
  side = "right",
  align = "start",
  mode: modeProp,
  readOnly = false,
  readOnlyReason,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: EventEditPopoverProps) {
  const mode = modeProp ?? (event ? "edit" : "create");

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (isControlled) {
        controlledOnOpenChange?.(nextOpen);
      } else {
        setInternalOpen(nextOpen);
      }
    },
    [isControlled, controlledOnOpenChange]
  );

  const { createEvent, updateEvent, deleteEvent } = useGoogleEventMutations();
  const moveEvent = useMoveGoogleEventMutation();

  const [operation, dispatchOperation] = useReducer(eventEditOperationReducer, {
    kind: "idle",
  });
  const nextOperationId = useRef(0);
  const runningOperations = useRef(new Set<number>());
  const buildCloseSaveRequestRef = useRef<(() => CloseSaveRequest) | null>(
    null
  );

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
    [deleteEvent.mutateAsync, moveEvent.mutateAsync, updateEvent.mutateAsync]
  );

  const prepareOperation = useCallback(
    (command: EventEditCommand, scope: RecurrenceScope, confirm: boolean) => {
      if (operation.kind !== "idle" || runningOperations.current.size > 0) {
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
      const next = eventEditOperationReducer({ kind: "idle" }, action);
      if (next.kind === "running") {
        runOperation(next);
      }
    },
    [operation.kind, runOperation]
  );

  const confirmOperation = useCallback(() => {
    if (operation.kind !== "confirming" && operation.kind !== "failed") {
      return;
    }
    const action = { id: operation.id, type: "run" as const };
    const next = eventEditOperationReducer(operation, action);
    dispatchOperation(action);
    if (next.kind === "running") {
      return runOperation(next);
    }
  }, [operation, runOperation]);

  const handleDelete = useCallback(() => {
    if (readOnly || !event || operation.kind !== "idle") {
      return;
    }
    setOpen(false);
    prepareOperation(
      {
        isRecurring: Boolean(
          event.recurringEventId || event.recurrence?.length
        ),
        kind: "delete",
        variables: { accountId, calendarId, eventId: event.id },
      },
      event.recurringEventId || !event.recurrence?.length ? "this" : "all",
      true
    );
  }, [
    accountId,
    calendarId,
    event,
    operation.kind,
    prepareOperation,
    readOnly,
    setOpen,
  ]);

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleSave = useCallback(() => {
    if (operation.kind !== "idle") {
      return;
    }
    if (readOnly) {
      setOpen(false);
      return;
    }
    const request = buildCloseSaveRequestRef.current?.() ?? { type: "none" };
    if (request.type === "blocked") {
      return;
    }
    setOpen(false);
    if (request.type === "none") {
      return;
    }
    if (request.type === "create") {
      createEvent.mutate(request.payload);
      return;
    }
    prepareOperation(
      request.command,
      request.defaultScope,
      request.command.isRecurring
    );
  }, [createEvent, operation.kind, prepareOperation, readOnly, setOpen]);

  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    { enabled: open && !readOnly, enableOnFormTags: true },
    [handleSave, open, readOnly]
  );

  return (
    <>
      <Popover
        onOpenChange={(nextOpen) => {
          if (nextOpen && operation.kind === "idle") {
            setOpen(true);
          }
        }}
        open={open}
      >
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-[420px] space-y-3 p-4"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleCancel();
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            handleCancel();
          }}
          onOpenAutoFocus={(e) => {
            if (mode === "edit") {
              e.preventDefault();
            }
          }}
          side={side}
        >
          <EventEditForm
            accountId={accountId}
            calendarId={calendarId}
            closeSaveRequestRef={buildCloseSaveRequestRef}
            end={end}
            event={event}
            key={event?.id ?? "create-event"}
            mode={mode}
            onCancel={handleCancel}
            onDelete={handleDelete}
            onSave={handleSave}
            open={open}
            readOnly={readOnly}
            readOnlyReason={readOnlyReason}
            start={start}
          />
        </PopoverContent>
      </Popover>

      <EventOperationDialog
        dispatch={dispatchOperation}
        onConfirm={confirmOperation}
        operation={operation}
      />
    </>
  );
}

function buildCreatePayload(
  values: EventFormValues & { recurrence: string[] },
  clampToStartIfNeeded: (
    s: Date | null,
    e: Date | null
  ) => { start: Date | null; end: Date | null },
  calendarTimeZone?: string
): CloseSaveRequest {
  const trimmedTitle = values.summary.trim();
  if (!trimmedTitle) {
    return { type: "none" };
  }

  const temporalPayload = buildTemporalPayload(values, clampToStartIfNeeded, {
    timeZone: values.recurrence?.length ? calendarTimeZone : undefined,
  });
  if (!temporalPayload) {
    return { type: "none" };
  }

  return {
    payload: {
      accountId: values.selectedAccountId,
      calendarId: values.selectedCalendarId,
      event: {
        colorId: values.colorId ?? undefined,
        conferenceData: values.conferenceData ?? undefined,
        description: values.description?.trim() || undefined,
        end: temporalPayload.endPayload,
        location: values.location?.trim() || undefined,
        recurrence:
          values.recurrence?.length > 0 ? values.recurrence : undefined,
        start: temporalPayload.startPayload,
        summary: trimmedTitle,
      },
    },
    type: "create",
  };
}

function buildEditPayload(
  values: EventFormValues & { recurrence: string[] },
  ctx: {
    accountId: string;
    calendarId: string;
    clampToStartIfNeeded: (
      s: Date | null,
      e: Date | null
    ) => { start: Date | null; end: Date | null };
    calendarTimeZone?: string;
    event: GoogleEvent | undefined;
    hasEdits: boolean;
  }
): CloseSaveRequest {
  const calendarChanged = values.selectedCalendarId !== ctx.calendarId;
  if (!(ctx.hasEdits || calendarChanged)) {
    return { type: "none" };
  }

  const isRecurring = Boolean(
    ctx.event?.recurringEventId || ctx.event?.recurrence?.length
  );
  const temporalPayload = buildTemporalPayload(
    values,
    ctx.clampToStartIfNeeded,
    {
      timeZone:
        values.recurrence.length || isRecurring
          ? ctx.calendarTimeZone
          : undefined,
    }
  );
  if (!temporalPayload) {
    return { type: "none" };
  }

  const variables: UpdateGoogleEventInput = {
    accountId: ctx.accountId,
    calendarId: ctx.calendarId,
    event: {
      ...ctx.event,
      colorId: values.colorId ?? undefined,
      conferenceData: values.conferenceData ?? undefined,
      description: values.description ?? "",
      end: {
        ...ctx.event?.end,
        ...temporalPayload.endPayload,
      },
      id: ctx.event?.id ?? "",
      location: values.location ?? "",
      recurrence: values.recurrence,
      start: {
        ...ctx.event?.start,
        ...temporalPayload.startPayload,
      },
      summary: values.summary.trim(),
    },
    eventId: ctx.event?.id ?? "",
  };

  return {
    command: {
      isRecurring,
      kind: "save",
      move: calendarChanged
        ? {
            accountId: ctx.accountId,
            calendarId: ctx.calendarId,
            destinationCalendarId: values.selectedCalendarId,
            eventId: variables.eventId,
          }
        : null,
      update: ctx.hasEdits ? variables : null,
    },
    defaultScope: isRecurring && !ctx.event?.recurringEventId ? "all" : "this",
    type: "save",
  };
}

function MeetingSection({
  meetingLink,
  isConferencePending,
  readOnly = false,
  onCreateMeeting,
}: {
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
  readOnly?: boolean;
  onCreateMeeting: () => void;
}) {
  if (meetingLink) {
    return (
      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Meeting
        </Label>
        <Button asChild size="sm" type="button" variant="outline">
          <a href={meetingLink.url} rel="noreferrer" target="_blank">
            <Video className="size-3" />
            Join {meetingLink.label}
          </a>
        </Button>
      </div>
    );
  }

  if (isConferencePending) {
    return (
      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Meeting
        </Label>
        <div className="text-muted-foreground text-xs">
          Google Meet will be created when you save.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="font-medium text-muted-foreground text-xs">
        Meeting
      </Label>
      <Button
        disabled={readOnly}
        onClick={onCreateMeeting}
        size="sm"
        type="button"
        variant="outline"
      >
        <Video className="size-3" />
        Add Google Meet
      </Button>
    </div>
  );
}

function EventColorAndTitleRow({
  colorEntries,
  selectedColorId,
  calendarFallbackColor,
  isCreateMode,
  readOnly = false,
  summary,
  onSelectColor,
  onSummaryChange,
}: {
  colorEntries: [string, { background?: string; foreground?: string }][];
  selectedColorId: string | undefined;
  calendarFallbackColor: string | undefined;
  isCreateMode: boolean;
  readOnly?: boolean;
  summary: string;
  onSelectColor: (colorKey: string | undefined) => void;
  onSummaryChange: (value: string) => void;
}) {
  const displayColor =
    colorEntries.find(([key]) => key === selectedColorId)?.[1]?.background ??
    calendarFallbackColor ??
    undefined;

  return (
    <div className="flex items-center gap-3">
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label="Pick color"
            className={cn(
              "size-8 rounded-full border-2 shadow-sm transition",
              readOnly ? "cursor-default" : "",
              selectedColorId ? "border-transparent" : "border-muted"
            )}
            disabled={readOnly}
            style={{ background: displayColor }}
            type="button"
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[220px]">
          <div className="flex flex-wrap gap-2">
            {colorEntries.map(([colorKey, palette]) => {
              const isSelected = selectedColorId === colorKey;
              return (
                <button
                  aria-label={`Color ${colorKey}`}
                  className={cn(
                    "size-7 rounded-full border-2 transition",
                    isSelected ? "ring-2 ring-primary ring-offset-2" : ""
                  )}
                  disabled={readOnly}
                  key={colorKey}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectColor(colorKey);
                  }}
                  style={{
                    background: palette.background,
                    borderColor: palette.foreground,
                  }}
                  type="button"
                />
              );
            })}
            <Button
              className="size-7 p-0 text-[10px]"
              disabled={readOnly}
              onClick={() => onSelectColor(undefined)}
              type="button"
              variant="ghost"
            >
              <Palette className="size-4" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Input
        className="flex-1"
        onChange={(e) => onSummaryChange(e.target.value)}
        placeholder={isCreateMode ? "Event title (required)" : "Event title"}
        readOnly={readOnly}
        value={summary}
      />
    </div>
  );
}

function EventAllDayAndRecurrenceRow({
  allDay,
  onToggleAllDay,
  canEditRecurrence,
  readOnly = false,
  recurrenceRule,
  recurrenceUnavailable,
  onRecurrenceChange,
  calendarOptions,
  calendarValue,
  onCalendarChange,
}: {
  allDay: boolean;
  onToggleAllDay: () => void;
  canEditRecurrence: boolean;
  readOnly?: boolean;
  recurrenceRule: string | undefined;
  recurrenceUnavailable: boolean;
  onRecurrenceChange: (rule: string | null) => void;
  calendarOptions: {
    accountId: string;
    calendarId: string;
    label: string;
    color?: string;
  }[];
  calendarValue: string;
  onCalendarChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        className="gap-2 text-xs"
        disabled={readOnly}
        onClick={onToggleAllDay}
        size="sm"
        type="button"
        variant="outline"
      >
        <div
          className={cn(
            "flex size-4 items-center justify-center rounded border transition-colors",
            allDay
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/50 bg-transparent"
          )}
        >
          {allDay ? <Check className="size-3" /> : null}
        </div>
        All day
      </Button>
      {canEditRecurrence ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              className="size-8"
              disabled={readOnly || recurrenceUnavailable}
              size="icon"
              variant="outline"
            >
              <Repeat className="size-4" />
              <span className="sr-only">Edit recurrence</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px]">
            <RecurrenceEditor
              onChange={onRecurrenceChange}
              recurrenceRule={recurrenceRule}
              visible={!recurrenceUnavailable}
            />
          </PopoverContent>
        </Popover>
      ) : null}
      <Select
        disabled={readOnly}
        onValueChange={onCalendarChange}
        value={calendarValue}
      >
        <SelectTrigger
          className="ml-auto h-8 w-auto min-w-0 gap-1.5 px-2 text-xs"
          disabled={readOnly}
        >
          <SelectValue placeholder="Calendar" />
        </SelectTrigger>
        <SelectContent>
          {calendarOptions.map((c) => (
            <SelectItem
              key={`${c.accountId}::${c.calendarId}`}
              value={`${c.accountId}::${c.calendarId}`}
            >
              <span className="flex items-center gap-2">
                {c.color ? (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                ) : null}
                {c.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EventLocationCombobox({
  location,
  suggestions,
  isSearching,
  mapsUrl,
  locationPopoverOpen,
  readOnly = false,
  onInputValueChange,
  onOpenChange,
  onValueChange,
  onFocusInput,
}: {
  location: string;
  suggestions: Array<{
    description: string;
    placeId?: string;
    primary: string;
    secondary?: string;
  }>;
  isSearching: boolean;
  mapsUrl: string | null;
  locationPopoverOpen: boolean;
  readOnly?: boolean;
  onInputValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string | null) => void;
  onFocusInput: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="font-medium text-muted-foreground text-xs">
        Location
      </Label>
      <Combobox
        disabled={readOnly}
        inputValue={location}
        onInputValueChange={onInputValueChange}
        onOpenChange={onOpenChange}
        onValueChange={onValueChange}
        open={locationPopoverOpen}
      >
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ComboboxInput
              className="w-full"
              disabled={readOnly}
              onFocus={onFocusInput}
              placeholder="Where?"
              showClear={Boolean(location)}
            />
          </div>
          {mapsUrl ? (
            <Button asChild size="icon" type="button" variant="outline">
              <a href={mapsUrl} rel="noreferrer" target="_blank">
                <MapPin className="size-3" />
                <span className="sr-only">Open in Google Maps</span>
              </a>
            </Button>
          ) : null}
        </div>
        <ComboboxContent align="start" sideOffset={6}>
          <ComboboxList>
            {suggestions.map((suggestion) => (
              <ComboboxItem
                key={suggestion.placeId ?? suggestion.description}
                value={suggestion.description}
              >
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">
                    {suggestion.primary}
                  </span>
                  {suggestion.secondary ? (
                    <span className="text-muted-foreground">
                      {suggestion.secondary}
                    </span>
                  ) : null}
                </div>
              </ComboboxItem>
            ))}
            <ComboboxEmpty>
              {isSearching ? "Searching…" : "No matches found."}
            </ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

function resolveWatchedDefaults(watched: Partial<EventFormValues>) {
  return {
    allDay: watched.allDay ?? false,
    colorId: watched.colorId,
    description: watched.description ?? "",
    endDate: watched.endDate,
    endTime: watched.endTime ?? "",
    location: watched.location ?? "",
    recurrenceDraft: watched.recurrenceDraft ?? { kind: "inherit" },
    conferenceData: watched.conferenceData ?? null,
    selectedAccountId: watched.selectedAccountId ?? "",
    selectedCalendarId: watched.selectedCalendarId ?? "",
    startDate: watched.startDate,
    startTime: watched.startTime ?? "",
    summary: watched.summary ?? "",
  };
}

function EventFormActionRow({
  isCreateMode,
  readOnly = false,
  onDelete,
  onCancel,
  onSave,
  saveDisabled,
}: {
  isCreateMode: boolean;
  saveDisabled: boolean;
  readOnly?: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <Separator />
      <div className="flex items-center gap-2">
        {isCreateMode || readOnly ? null : (
          <Button
            className="gap-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={onDelete}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {readOnly ? null : (
            <Button
              disabled={saveDisabled}
              onClick={onSave}
              size="sm"
              type="button"
            >
              Save
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function RecurrenceQueryFeedback({
  status,
  onRetry,
}: {
  status: ReturnType<typeof resolveEventRecurrence>["kind"];
  onRetry: () => void;
}) {
  if (status === "loading") {
    return (
      <p className="text-muted-foreground text-xs">
        Loading series recurrence…
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className="text-destructive text-xs">
        Could not load series recurrence.{" "}
        <Button onClick={onRetry} size="sm" type="button" variant="ghost">
          Retry
        </Button>
      </p>
    );
  }
  return null;
}

export function EventEditForm({
  event,
  accountId,
  calendarId,
  start,
  end,
  mode,
  closeSaveRequestRef,
  onSave,
  onCancel,
  onDelete,
  open,
  readOnly = false,
  readOnlyReason,
  headerContent,
  createInteropRef,
}: {
  event?: GoogleEvent;
  accountId: string;
  calendarId: string;
  start: Date;
  end: Date;
  mode: "create" | "edit";
  closeSaveRequestRef: React.Ref<() => CloseSaveRequest>;
  /** Trigger the save flow (builds close-save request and processes it). */
  onSave: () => void;
  /** Close without saving. When provided, the form shows its own Save/Cancel buttons. */
  onCancel?: () => void;
  onDelete: () => void;
  open: boolean;
  readOnly?: boolean;
  readOnlyReason?: string | null;
  headerContent?: ReactNode;
  createInteropRef?: React.Ref<CalendarCreateFormInterop>;
}) {
  const isCreateMode = mode === "create";
  // Delete hotkey - only active when popover is open in edit mode, skips text inputs
  // Uses "backspace" for Mac compatibility (Mac's delete key = backspace)
  useHotkeys(
    "backspace, delete",
    (e) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (tagName === "input" || tagName === "textarea") {
        return;
      }
      e.preventDefault();
      onDelete();
    },
    { enabled: open && !isCreateMode && !readOnly },
    [onDelete, open, isCreateMode, readOnly]
  );
  // Closing the popover alone discards edits; the wrapper owns saves and dialogs.
  const hasDataEditsRef = useRef(false);

  const masterQuery = useRecurringEventMaster({
    accountId,
    calendarId,
    enabled: open && !isCreateMode,
    event: event ?? null,
  });

  const isAllDay = Boolean(event?.start?.date);
  const initialStartDate = useMemo(() => {
    if (isAllDay && event?.start?.date) {
      return new Date(event.start.date);
    }
    return start;
  }, [event?.start?.date, isAllDay, start]);

  const initialEndDate = useMemo(() => {
    if (isAllDay && event?.end?.date) {
      // Google all-day events use exclusive end date, subtract 1 day for display
      const endPlainDate = pickerDateToTemporal(new Date(event.end.date));
      const adjustedDate = endPlainDate.subtract({ days: 1 });
      return new Date(
        adjustedDate.year,
        adjustedDate.month - 1,
        adjustedDate.day
      );
    }
    return end;
  }, [end, event?.end?.date, isAllDay]);

  const initialValues = useMemo<EventFormValues>(
    () => ({
      allDay: isAllDay,
      colorId: event?.colorId ?? undefined,
      description: event?.description ?? "",
      endDate: initialEndDate ?? null,
      endTime: isAllDay ? "" : formatTimeString(initialEndDate),
      location: event?.location ?? "",
      recurrenceDraft: { kind: "inherit" },
      conferenceData: event?.conferenceData ?? null,
      selectedAccountId: accountId,
      selectedCalendarId: calendarId,
      startDate: initialStartDate ?? null,
      startTime: isAllDay ? "" : formatTimeString(initialStartDate),
      summary: event?.summary ?? "",
    }),
    [
      accountId,
      calendarId,
      event?.colorId,
      event?.description,
      event?.location,
      event?.summary,
      event?.conferenceData,
      initialEndDate,
      initialStartDate,
      isAllDay,
    ]
  );

  const { control, setValue, getValues } = useForm<EventFormValues>({
    defaultValues: initialValues,
  });
  const [locationOpen, setLocationOpen] = useState(false);

  const watchedValues = useWatch({ control, compute: resolveWatchedDefaults });
  const locationQuery = watchedValues.location.trim();
  const locationSearch = useLocationSearch(locationQuery);
  const locationSuggestions = locationSearch.data ?? [];
  const isLocationSearching = locationSearch.isFetching;

  const meetingSource = useMemo(
    () => ({
      ...(event ?? {}),
      conferenceData: watchedValues.conferenceData ?? undefined,
      description: watchedValues.description,
      location: watchedValues.location,
    }),
    [
      event,
      watchedValues.conferenceData,
      watchedValues.description,
      watchedValues.location,
    ]
  );
  const meetingLink = useMemo(
    () => extractMeetingLink(meetingSource),
    [meetingSource]
  );
  const isConferencePending = Boolean(
    watchedValues.conferenceData?.createRequest
  );
  const canCreateMeeting = !(meetingLink || isConferencePending);
  const mapsUrl = locationQuery ? getMapsSearchUrl(locationQuery) : null;
  const locationPopoverOpen = locationOpen && locationQuery.length >= 2;

  const effectiveAccountId = watchedValues.selectedAccountId ?? accountId;
  const effectiveCalendarId = watchedValues.selectedCalendarId ?? calendarId;

  const paletteForAccount = useAtomValue(
    normalizedGoogleColorsAtomFamily(effectiveAccountId)
  );
  const calendars = useAtomValue(googleCalendarsDataAtom);

  // Writable calendar options for the calendar picker (both modes).
  // In edit mode, only same-account calendars (cross-account moves not supported).
  const calendarPickerOptions = useMemo(
    () =>
      calendars.reduce<
        Array<{
          accountId: string;
          calendarId: string;
          label: string;
          color: string | undefined;
        }>
      >((acc, c) => {
        if (
          (c.calendar.accessRole === "writer" ||
            c.calendar.accessRole === "owner") &&
          (isCreateMode || c.accountId === accountId)
        ) {
          acc.push({
            accountId: c.accountId,
            calendarId: c.calendar.id,
            color: pastelizeColor(c.calendar.backgroundColor),
            label: c.calendar.summary ?? "Calendar",
          });
        }
        return acc;
      }, []),
    [accountId, calendars, isCreateMode]
  );

  const calendar = calendars.find(
    (c) =>
      c.accountId === effectiveAccountId &&
      c.calendar.id === effectiveCalendarId
  );
  const calendarFallbackColor = pastelizeColor(
    calendar?.calendar.backgroundColor
  );

  const colorEntries = useMemo(
    () =>
      paletteForAccount?.event ? Object.entries(paletteForAccount.event) : [],
    [paletteForAccount]
  );

  // Prevent end from preceding start when the user toggles dates out of order.
  const clampToStartIfNeeded = useCallback(
    (nextStart: Date | null, nextEnd: Date | null) => {
      if (!(nextStart && nextEnd)) {
        return { end: nextEnd, start: nextStart };
      }
      if (nextEnd < nextStart) {
        return { end: nextStart, start: nextStart };
      }
      return { end: nextEnd, start: nextStart };
    },
    []
  );

  const handleTimeChange = (field: "startTime" | "endTime", value: string) => {
    if (readOnly) {
      return;
    }
    if (!value) {
      hasDataEditsRef.current = true;
      setValue(field, "", { shouldDirty: true });
      return;
    }
    const [hours, minutes] = value.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return;
    }

    hasDataEditsRef.current = true;
    setValue(
      field,
      `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
      {
        shouldDirty: true,
      }
    );
  };

  const handleLocationInputChange = useCallback(
    (value: string) => {
      if (readOnly) {
        return;
      }
      hasDataEditsRef.current = true;
      setValue("location", value, { shouldDirty: true });
      if (value.trim().length >= 2) {
        setLocationOpen(true);
      } else {
        setLocationOpen(false);
      }
    },
    [readOnly, setValue]
  );

  const handleLocationValueChange = useCallback(
    (value: string | null) => {
      if (readOnly) {
        return;
      }
      if (!value) {
        return;
      }
      hasDataEditsRef.current = true;
      setValue("location", value, { shouldDirty: true });
      setLocationOpen(false);
    },
    [readOnly, setValue]
  );

  const handleLocationOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (readOnly) {
        setLocationOpen(false);
        return;
      }
      if (!nextOpen) {
        setLocationOpen(false);
        return;
      }
      if (locationQuery.length >= 2) {
        setLocationOpen(true);
      }
    },
    [locationQuery.length, readOnly]
  );

  const handleCreateMeeting = useCallback(() => {
    if (readOnly) {
      return;
    }
    if (!canCreateMeeting) {
      return;
    }
    hasDataEditsRef.current = true;
    const nextConference = buildGoogleMeetConferenceData();
    setValue("conferenceData", nextConference, { shouldDirty: true });
    if (!isCreateMode) {
      onSave();
    }
  }, [canCreateMeeting, isCreateMode, onSave, readOnly, setValue]);

  const buildCloseSaveRequest = useCallback(
    (values: EventFormValues): CloseSaveRequest => {
      if (readOnly) {
        return { type: "none" };
      }
      const recurrence = resolveEventRecurrence({
        draft: values.recurrenceDraft,
        event,
        master: masterQuery,
      });
      // Never submit an unresolved inherited recurrence as an explicit clear.
      if (recurrence.kind !== "ready") {
        return { type: "blocked" };
      }
      const snapshot = { ...values, recurrence: recurrence.rules };
      if (isCreateMode) {
        return buildCreatePayload(
          snapshot,
          clampToStartIfNeeded,
          calendar?.calendar.timeZone
        );
      }
      return buildEditPayload(snapshot, {
        accountId,
        calendarId,
        calendarTimeZone: calendar?.calendar.timeZone,
        clampToStartIfNeeded,
        event,
        hasEdits: hasDataEditsRef.current,
      });
    },
    [
      accountId,
      calendarId,
      clampToStartIfNeeded,
      event,
      isCreateMode,
      calendar?.calendar.timeZone,
      masterQuery,
      readOnly,
    ]
  );

  useImperativeHandle(
    closeSaveRequestRef,
    () => () => buildCloseSaveRequest(getValues()),
    [buildCloseSaveRequest, getValues]
  );

  const applySharedFields = useCallback(
    (fields: CalendarCreateSharedFields) => {
      const nextStartDate = fields.startDate ?? null;
      const nextStartTime = fields.startTime;
      const nextEnd = buildSharedEndFields(
        nextStartDate,
        nextStartTime,
        fields.durationMinutes
      );

      hasDataEditsRef.current = true;
      setValue("conferenceData", null, { shouldDirty: true });
      setValue("summary", fields.title, { shouldDirty: true });
      setValue("description", fields.description, { shouldDirty: true });
      setValue("startDate", nextStartDate, { shouldDirty: true });
      setValue("endDate", nextEnd.endDate, { shouldDirty: true });
      setValue("startTime", nextStartTime, { shouldDirty: true });
      setValue("endTime", nextEnd.endTime, { shouldDirty: true });
      setValue("allDay", false, { shouldDirty: true });
      setValue("location", "", { shouldDirty: true });
      setValue("colorId", undefined, { shouldDirty: true });
      setValue("recurrenceDraft", { kind: "inherit" }, { shouldDirty: true });
    },
    [setValue]
  );

  const getSharedFields = useCallback(
    () => getSharedFieldsFromEventValues(getValues()),
    [getValues]
  );

  useImperativeHandle(
    createInteropRef,
    () => ({ applySharedFields, getSharedFields }),
    [applySharedFields, getSharedFields]
  );

  const startTimeValue = watchedValues.allDay ? "" : watchedValues.startTime;
  const endTimeValue = watchedValues.allDay ? "" : watchedValues.endTime;
  const resolvedRecurrence = resolveEventRecurrence({
    draft: watchedValues.recurrenceDraft,
    event,
    master: masterQuery,
  });
  const recurrenceRule =
    resolvedRecurrence.kind === "ready"
      ? resolvedRecurrence.rules[0]
      : undefined;
  const canEditRecurrence =
    isCreateMode ||
    Boolean(event?.recurrence?.length || event?.recurringEventId);

  return (
    <div className="space-y-3">
      {headerContent ? <div>{headerContent}</div> : null}
      {readOnly && readOnlyReason ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">{readOnlyReason}</p>
        </div>
      ) : null}

      <EventColorAndTitleRow
        calendarFallbackColor={calendarFallbackColor}
        colorEntries={colorEntries}
        isCreateMode={isCreateMode}
        onSelectColor={(colorKey) => {
          hasDataEditsRef.current = true;
          setValue("colorId", colorKey, { shouldDirty: true });
        }}
        onSummaryChange={(value) => {
          hasDataEditsRef.current = true;
          setValue("summary", value, { shouldDirty: true });
        }}
        readOnly={readOnly}
        selectedColorId={watchedValues.colorId}
        summary={watchedValues.summary}
      />

      <Textarea
        onChange={(e) => {
          hasDataEditsRef.current = true;
          setValue("description", e.target.value, { shouldDirty: true });
        }}
        placeholder="Add details..."
        readOnly={readOnly}
        value={watchedValues.description}
      />

      <Separator />

      <EventAllDayAndRecurrenceRow
        allDay={watchedValues.allDay}
        calendarOptions={calendarPickerOptions}
        calendarValue={`${effectiveAccountId}::${effectiveCalendarId}`}
        canEditRecurrence={canEditRecurrence}
        onCalendarChange={(val) => {
          const opt = calendarPickerOptions.find(
            (c) => `${c.accountId}::${c.calendarId}` === val
          );
          if (opt) {
            setValue("selectedAccountId", opt.accountId, {
              shouldDirty: true,
            });
            setValue("selectedCalendarId", opt.calendarId, {
              shouldDirty: true,
            });
          }
        }}
        onRecurrenceChange={(rule) => {
          hasDataEditsRef.current = true;
          setValue(
            "recurrenceDraft",
            { kind: "override", rules: rule ? [rule] : [] },
            { shouldDirty: true }
          );
        }}
        onToggleAllDay={() => {
          hasDataEditsRef.current = true;
          setValue("allDay", !watchedValues.allDay, { shouldDirty: true });
        }}
        readOnly={readOnly}
        recurrenceRule={recurrenceRule}
        recurrenceUnavailable={resolvedRecurrence.kind !== "ready"}
      />

      <RecurrenceQueryFeedback
        onRetry={() => masterQuery.refetch()}
        status={resolvedRecurrence.kind}
      />

      <div className="grid grid-cols-2 gap-2">
        <Controller
          control={control}
          name="startDate"
          render={({ field }) => (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  className={cn(
                    "justify-start gap-2 text-left font-medium text-xs",
                    !field.value && "text-muted-foreground"
                  )}
                  disabled={readOnly}
                  variant="outline"
                >
                  <CalendarIcon className="size-4" />
                  {field.value
                    ? formatPlainDate(pickerDateToTemporal(field.value), {
                        day: "numeric",
                        month: "short",
                      })
                    : "Start date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  disabled={readOnly}
                  mode="single"
                  onSelect={(date) => {
                    const next = date ?? null;
                    const clamped = clampToStartIfNeeded(
                      next,
                      watchedValues.endDate ?? null
                    );
                    hasDataEditsRef.current = true;
                    field.onChange(clamped.start);
                    setValue("endDate", clamped.end, { shouldDirty: true });
                  }}
                  selected={field.value ?? undefined}
                />
              </PopoverContent>
            </Popover>
          )}
        />

        <Controller
          control={control}
          name="endDate"
          render={({ field }) => (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  className={cn(
                    "justify-start gap-2 text-left font-medium text-xs",
                    !field.value && "text-muted-foreground"
                  )}
                  disabled={readOnly}
                  variant="outline"
                >
                  <CalendarIcon className="size-4" />
                  {field.value
                    ? formatPlainDate(pickerDateToTemporal(field.value), {
                        day: "numeric",
                        month: "short",
                      })
                    : "End date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  disabled={readOnly}
                  mode="single"
                  onSelect={(date) => {
                    const next = date ?? null;
                    const clamped = clampToStartIfNeeded(
                      watchedValues.startDate ?? null,
                      next
                    );
                    hasDataEditsRef.current = true;
                    field.onChange(clamped.end);
                    setValue("startDate", clamped.start, { shouldDirty: true });
                  }}
                  selected={field.value ?? undefined}
                />
              </PopoverContent>
            </Popover>
          )}
        />
      </div>

      {watchedValues.allDay ? null : (
        <div className="grid grid-cols-2 gap-2">
          <TimePicker
            disabled={readOnly}
            onChange={(v) => handleTimeChange("startTime", v)}
            placeholder="Start time"
            value={startTimeValue}
          />
          <TimePicker
            disabled={readOnly}
            icon={<Timer className="size-4 shrink-0" />}
            onChange={(v) => handleTimeChange("endTime", v)}
            placeholder="End time"
            value={endTimeValue}
          />
        </div>
      )}

      <MeetingSection
        isConferencePending={isConferencePending}
        meetingLink={meetingLink}
        onCreateMeeting={handleCreateMeeting}
        readOnly={readOnly}
      />

      <EventLocationCombobox
        isSearching={isLocationSearching}
        location={watchedValues.location}
        locationPopoverOpen={locationPopoverOpen}
        mapsUrl={mapsUrl}
        onFocusInput={() => {
          if (locationQuery.length >= 2) {
            setLocationOpen(true);
          }
        }}
        onInputValueChange={handleLocationInputChange}
        onOpenChange={handleLocationOpenChange}
        onValueChange={handleLocationValueChange}
        readOnly={readOnly}
        suggestions={locationSuggestions}
      />

      {onCancel ? (
        <EventFormActionRow
          isCreateMode={isCreateMode}
          onCancel={onCancel}
          onDelete={onDelete}
          onSave={onSave}
          readOnly={readOnly}
          saveDisabled={resolvedRecurrence.kind !== "ready"}
        />
      ) : null}
    </div>
  );
}
