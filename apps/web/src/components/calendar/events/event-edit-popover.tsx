"use client";

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
  dateToUntilRule,
  untilRuleToDate,
} from "@kompose/state/google-event-recurrence";
import {
  type CreateGoogleEventInput,
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
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { RecurrenceScopeDialog } from "@/components/recurrence-scope-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  /** The event to edit. Optional for create mode. */
  event?: GoogleEvent;
  /** Whether the popover is in create or edit mode. Defaults based on event presence. */
  mode?: "create" | "edit";
  /** Callback when open state changes (for controlled mode). */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state (optional). If provided, the popover is controlled. */
  open?: boolean;
  readOnly?: boolean;
  readOnlyReason?: string | null;
  side?: "top" | "right" | "bottom" | "left";
  start: Date;
}

interface EventFormValues {
  allDay: boolean;
  colorId?: string;
  description: string;
  endDate: Date | null;
  endTime: string;
  location: string;
  recurrence: string[];
  /** Selected calendar for create mode (accountId) */
  selectedAccountId: string;
  /** Selected calendar for create mode (calendarId) */
  selectedCalendarId: string;
  startDate: Date | null;
  startTime: string;
  summary: string;
}

type CloseSaveRequest =
  | { type: "none" }
  | {
      type: "save";
      /**
       * Mutation payload that represents the user’s edits.
       * We keep recurrence scope out of the form and ask for it after close.
       */
      variables: UpdateGoogleEventInput;
      /** Whether this edit targets a recurring event (instance or master). */
      isRecurring: boolean;
      /** Which scope should be preselected in the post-close scope dialog. */
      defaultScope: RecurrenceScope;
      /** Whether event data (non-calendar fields) were actually edited. */
      hasDataEdits: boolean;
      /** If the user changed the calendar, include the destination for a move. */
      calendarChanged?: { destinationCalendarId: string };
    }
  | {
      type: "create";
      /** Payload for creating a new event */
      payload: CreateGoogleEventInput;
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
    title: values.summary,
    description: values.description,
    startDate,
    startTime: values.startTime,
    durationMinutes,
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

  interface RecurrenceEditorValues {
    byDay: string[];
    count: number;
    endType: RecurrenceEnd["type"];
    freq: Frequency;
    /** Stored as RRULE UNTIL value (e.g. `YYYYMMDDT...Z`). Empty means unset. */
    untilRule: string;
  }

  const defaultValues = useMemo<RecurrenceEditorValues>(() => {
    const endType = parsedRecurrence.end.type;
    return {
      freq: parsedRecurrence.freq,
      byDay: parsedRecurrence.byDay,
      endType,
      untilRule: endType === "until" ? parsedRecurrence.end.date : "",
      count: endType === "count" ? parsedRecurrence.end.count : 5,
    };
  }, [parsedRecurrence.byDay, parsedRecurrence.end, parsedRecurrence.freq]);

  const { control, reset, setValue } = useForm<RecurrenceEditorValues>({
    defaultValues,
  });
  const watched = useWatch({ control }) as RecurrenceEditorValues | undefined;
  // `useWatch` can briefly return undefined; fall back to stable defaults.
  const values = watched ?? defaultValues;

  const lastEmittedRuleRef = useRef<string | null>(null);

  const buildEndFromValues = useCallback(
    (v: RecurrenceEditorValues): RecurrenceEnd => {
      if (v.endType === "none") {
        return { type: "none" };
      }
      if (v.endType === "until") {
        return v.untilRule
          ? { type: "until", date: v.untilRule }
          : { type: "none" };
      }
      if (v.endType === "count") {
        return v.count > 0
          ? { type: "count", count: v.count }
          : { type: "none" };
      }
      return { type: "none" };
    },
    []
  );

  // Sync internal editor state when the upstream rule changes (e.g. switching events),
  // but avoid resetting when the change was emitted by this editor itself.
  useEffect(() => {
    const upstream = recurrenceRule ?? null;
    if (upstream === lastEmittedRuleRef.current) {
      return;
    }
    reset(defaultValues);
  }, [defaultValues, recurrenceRule, reset]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const end = buildEndFromValues(values);
    const nextRule = buildRecurrenceRule(values.freq, values.byDay, end);
    const normalizedNext = nextRule ?? null;
    if (normalizedNext === lastEmittedRuleRef.current) {
      return;
    }
    lastEmittedRuleRef.current = normalizedNext;
    onChangeRef.current(nextRule);
  }, [values, buildEndFromValues]);

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
            setValue("freq", nextFreq);
            if (nextFreq !== "WEEKLY") {
              setValue("byDay", []);
            }
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
                    setValue("byDay", next);
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
              setValue("endType", "none");
              setValue("untilRule", "");
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
                setValue("endType", "until");
                setValue("untilRule", fallback);
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
                          month: "short",
                          day: "numeric",
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
                        setValue("untilRule", "");
                        setValue("endType", "none");
                        return;
                      }
                      const rule = dateToUntilRule(date);
                      if (rule) {
                        setValue("untilRule", rule);
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
                setValue("endType", "count");
                setValue(
                  "count",
                  Number.isFinite(values.count) && values.count > 0
                    ? values.count
                    : 5
                );
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
                      setValue("count", parsed);
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

// Temporal / calendar helpers live in `event-edit-utils.ts`.

interface EventEditDialogState {
  deleteDialogOpen: boolean;
  deleteScope: RecurrenceScope;
  simpleDeleteConfirmOpen: boolean;
  scopeDialogOpen: boolean;
  pendingSave: {
    variables: UpdateGoogleEventInput;
    defaultScope: RecurrenceScope;
    hasDataEdits: boolean;
    calendarChanged?: { destinationCalendarId: string };
  } | null;
  selectedScope: RecurrenceScope;
}

type EventEditDialogAction =
  | { type: "open-recurring-delete"; scope: RecurrenceScope }
  | { type: "set-delete-dialog-open"; value: boolean }
  | { type: "set-delete-scope"; value: RecurrenceScope }
  | { type: "open-simple-delete" }
  | { type: "set-simple-delete-open"; value: boolean }
  | {
      type: "open-scope-dialog";
      pendingSave: EventEditDialogState["pendingSave"];
      scope: RecurrenceScope;
    }
  | { type: "set-scope-dialog-open"; value: boolean }
  | { type: "set-selected-scope"; value: RecurrenceScope }
  | { type: "clear-pending-save" };

const eventEditDialogInitialState: EventEditDialogState = {
  deleteDialogOpen: false,
  deleteScope: "this",
  simpleDeleteConfirmOpen: false,
  scopeDialogOpen: false,
  pendingSave: null,
  selectedScope: "this",
};

function eventEditDialogReducer(
  state: EventEditDialogState,
  action: EventEditDialogAction
): EventEditDialogState {
  switch (action.type) {
    case "open-recurring-delete":
      return { ...state, deleteDialogOpen: true, deleteScope: action.scope };
    case "set-delete-dialog-open":
      return { ...state, deleteDialogOpen: action.value };
    case "set-delete-scope":
      return { ...state, deleteScope: action.value };
    case "open-simple-delete":
      return { ...state, simpleDeleteConfirmOpen: true };
    case "set-simple-delete-open":
      return { ...state, simpleDeleteConfirmOpen: action.value };
    case "open-scope-dialog":
      return {
        ...state,
        scopeDialogOpen: true,
        pendingSave: action.pendingSave,
        selectedScope: action.scope,
      };
    case "set-scope-dialog-open":
      return { ...state, scopeDialogOpen: action.value };
    case "set-selected-scope":
      return { ...state, selectedScope: action.value };
    case "clear-pending-save":
      return { ...state, pendingSave: null };
    default:
      return state;
  }
}

/**
 * Inline editor for Google events, mirroring TaskEditPopover behavior.
 * Supports both create and edit modes.
 */
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
  // Determine mode: explicit prop, or infer from event presence
  const mode = modeProp ?? (event ? "edit" : "create");

  // Support both controlled and uncontrolled open state
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

  const [dialogState, dispatchDialog] = useReducer(
    eventEditDialogReducer,
    eventEditDialogInitialState
  );
  const {
    deleteDialogOpen,
    deleteScope,
    simpleDeleteConfirmOpen,
    scopeDialogOpen,
    pendingSave,
    selectedScope,
  } = dialogState;

  const buildCloseSaveRequestRef = useRef<(() => CloseSaveRequest) | null>(
    null
  );

  const commitPendingSave = useCallback(async () => {
    if (!pendingSave) {
      return;
    }
    const { variables, hasDataEdits, calendarChanged } = pendingSave;
    // Save event data if there are actual field edits
    if (hasDataEdits) {
      await updateEvent.mutateAsync({
        ...variables,
        recurrenceScope: selectedScope,
      });
    }
    // Move to the new calendar if the user changed it
    if (calendarChanged && event) {
      await moveEvent.mutateAsync({
        accountId,
        calendarId,
        eventId: event.id,
        destinationCalendarId: calendarChanged.destinationCalendarId,
        scope: selectedScope,
      });
    }
    dispatchDialog({ type: "clear-pending-save" });
  }, [
    accountId,
    calendarId,
    event,
    moveEvent,
    pendingSave,
    selectedScope,
    updateEvent,
  ]);

  // Handle delete - opens appropriate confirmation dialog (edit mode only)
  const handleDelete = useCallback(() => {
    if (readOnly) {
      return;
    }
    if (!event) {
      return;
    }
    setOpen(false);
    if (event.recurringEventId || event.recurrence?.length) {
      const defaultScope = event.recurringEventId ? "this" : "all";
      dispatchDialog({ type: "open-recurring-delete", scope: defaultScope });
    } else {
      dispatchDialog({ type: "open-simple-delete" });
    }
  }, [event, readOnly, setOpen]);

  // Commit delete for non-recurring events
  const confirmSimpleDelete = useCallback(() => {
    if (!event) {
      return;
    }
    deleteEvent.mutate({
      accountId,
      calendarId,
      eventId: event.id,
      scope: "this",
    });
    dispatchDialog({ type: "set-simple-delete-open", value: false });
  }, [accountId, calendarId, deleteEvent, event]);

  // Commit delete with selected scope
  const commitDelete = useCallback(async () => {
    if (!event) {
      return;
    }
    await deleteEvent.mutateAsync({
      accountId,
      calendarId,
      eventId: event.id,
      scope: deleteScope,
    });
  }, [accountId, calendarId, deleteEvent, deleteScope, event]);

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleSave = useCallback(() => {
    if (readOnly) {
      setOpen(false);
      return;
    }
    const request = buildCloseSaveRequestRef.current?.() ?? { type: "none" };
    setOpen(false);

    if (request.type === "none") {
      return;
    }

    if (request.type === "create") {
      createEvent.mutate(request.payload);
      return;
    }

    if (request.type === "save") {
      if (request.isRecurring) {
        const forceAll = Boolean(request.calendarChanged);
        const scope = forceAll ? "all" : request.defaultScope;
        dispatchDialog({
          type: "open-scope-dialog",
          pendingSave: {
            variables: request.variables,
            defaultScope: scope,
            hasDataEdits: request.hasDataEdits,
            calendarChanged: request.calendarChanged,
          },
          scope,
        });
        return;
      }

      const saveAndMove = async () => {
        if (request.hasDataEdits) {
          await updateEvent.mutateAsync({
            ...request.variables,
            recurrenceScope: "this",
          });
        }
        if (request.calendarChanged && event) {
          await moveEvent.mutateAsync({
            accountId,
            calendarId,
            eventId: event.id,
            destinationCalendarId:
              request.calendarChanged.destinationCalendarId,
            scope: "this",
          });
        }
      };
      saveAndMove().catch(() => null);
    }
  }, [
    accountId,
    calendarId,
    createEvent,
    event,
    moveEvent,
    readOnly,
    setOpen,
    updateEvent,
  ]);

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
          if (nextOpen) {
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
            end={end}
            event={event}
            mode={mode}
            onCancel={handleCancel}
            onDelete={handleDelete}
            onRegisterCloseSaveRequest={(fn) => {
              buildCloseSaveRequestRef.current = fn;
            }}
            onSave={handleSave}
            open={open}
            readOnly={readOnly}
            readOnlyReason={readOnlyReason}
            start={start}
          />
        </PopoverContent>
      </Popover>

      {/* Post-close recurrence scope prompt (covers both save and move for recurring events). */}
      <RecurrenceScopeDialog
        description={
          pendingSave?.calendarChanged
            ? "Moving to a different calendar applies to all events in the series."
            : "Choose how broadly to apply your changes."
        }
        disabledScopes={
          pendingSave?.calendarChanged
            ? { this: true, following: true }
            : undefined
        }
        onCancel={() => dispatchDialog({ type: "clear-pending-save" })}
        onConfirm={commitPendingSave}
        onOpenChange={(value) =>
          dispatchDialog({ type: "set-scope-dialog-open", value })
        }
        onValueChange={(value) =>
          dispatchDialog({ type: "set-selected-scope", value })
        }
        open={scopeDialogOpen}
        title="Save recurring event changes"
        value={selectedScope}
      />

      {/* Delete scope dialog for recurring events */}
      <RecurrenceScopeDialog
        confirmLabel="Delete"
        description="Choose how broadly to apply the deletion."
        onCancel={() =>
          dispatchDialog({ type: "set-delete-dialog-open", value: false })
        }
        onConfirm={commitDelete}
        onOpenChange={(value) =>
          dispatchDialog({ type: "set-delete-dialog-open", value })
        }
        onValueChange={(value) =>
          dispatchDialog({ type: "set-delete-scope", value })
        }
        open={deleteDialogOpen}
        title="Delete recurring event"
        value={deleteScope}
      />

      {/* Simple delete confirmation for non-recurring events */}
      <AlertDialog
        onOpenChange={(value) =>
          dispatchDialog({ type: "set-simple-delete-open", value })
        }
        open={simpleDeleteConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSimpleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function buildCreatePayload(
  values: EventFormValues,
  clampToStartIfNeeded: (
    s: Date | null,
    e: Date | null
  ) => { start: Date | null; end: Date | null },
  conferenceData: GoogleEvent["conferenceData"] | null | undefined,
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
    type: "create",
    payload: {
      accountId: values.selectedAccountId,
      calendarId: values.selectedCalendarId,
      event: {
        summary: trimmedTitle,
        description: values.description?.trim() || undefined,
        location: values.location?.trim() || undefined,
        colorId: values.colorId ?? undefined,
        recurrence:
          values.recurrence?.length > 0 ? values.recurrence : undefined,
        conferenceData: conferenceData ?? undefined,
        start: temporalPayload.startPayload,
        end: temporalPayload.endPayload,
      },
    },
  };
}

function buildEditPayload(
  values: EventFormValues,
  ctx: {
    accountId: string;
    calendarId: string;
    clampToStartIfNeeded: (
      s: Date | null,
      e: Date | null
    ) => { start: Date | null; end: Date | null };
    conferenceData: GoogleEvent["conferenceData"] | null | undefined;
    calendarTimeZone?: string;
    event: GoogleEvent | undefined;
    hasEdits: boolean;
    masterRecurrence: string[] | null | undefined;
  }
): CloseSaveRequest {
  const calendarChanged = values.selectedCalendarId !== ctx.calendarId;
  if (!(ctx.hasEdits || calendarChanged)) {
    return { type: "none" };
  }

  const temporalPayload = buildTemporalPayload(
    values,
    ctx.clampToStartIfNeeded,
    {
      timeZone:
        values.recurrence?.length ||
        ctx.event?.recurringEventId ||
        ctx.event?.recurrence?.length ||
        ctx.masterRecurrence?.length
          ? ctx.calendarTimeZone
          : undefined,
    }
  );
  if (!temporalPayload) {
    return { type: "none" };
  }

  const isRecurring = Boolean(
    ctx.event?.recurringEventId ||
      ctx.event?.recurrence?.length ||
      ctx.masterRecurrence?.length
  );
  const defaultScope: RecurrenceScope = ctx.event?.recurringEventId
    ? "this"
    : "all";

  const variables: UpdateGoogleEventInput = {
    accountId: ctx.accountId,
    calendarId: ctx.calendarId,
    eventId: ctx.event?.id ?? "",
    event: {
      ...ctx.event,
      id: ctx.event?.id ?? "",
      summary: values.summary.trim(),
      description: values.description ?? "",
      location: values.location ?? "",
      colorId: values.colorId ?? undefined,
      recurrence: values.recurrence ?? ctx.event?.recurrence,
      conferenceData: ctx.conferenceData ?? undefined,
      start: {
        ...ctx.event?.start,
        ...temporalPayload.startPayload,
      },
      end: {
        ...ctx.event?.end,
        ...temporalPayload.endPayload,
      },
    },
  };

  return {
    type: "save",
    variables,
    isRecurring,
    defaultScope,
    hasDataEdits: ctx.hasEdits,
    calendarChanged: calendarChanged
      ? { destinationCalendarId: values.selectedCalendarId }
      : undefined,
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
              disabled={readOnly}
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
              visible
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
    summary: watched.summary ?? "",
    description: watched.description ?? "",
    location: watched.location ?? "",
    allDay: watched.allDay ?? false,
    colorId: watched.colorId,
    startDate: watched.startDate,
    endDate: watched.endDate,
    startTime: watched.startTime ?? "",
    endTime: watched.endTime ?? "",
    recurrence: watched.recurrence ?? [],
    selectedAccountId: watched.selectedAccountId ?? "",
    selectedCalendarId: watched.selectedCalendarId ?? "",
  };
}

function EventFormActionRow({
  isCreateMode,
  readOnly = false,
  onDelete,
  onCancel,
  onSave,
}: {
  isCreateMode: boolean;
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
            <Button onClick={onSave} size="sm" type="button">
              Save
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

export function EventEditForm({
  event,
  accountId,
  calendarId,
  start,
  end,
  mode,
  onRegisterCloseSaveRequest,
  onSave,
  onCancel,
  onDelete,
  open,
  readOnly = false,
  readOnlyReason,
  headerContent,
  onRegisterCreateInterop,
}: {
  event?: GoogleEvent;
  accountId: string;
  calendarId: string;
  start: Date;
  end: Date;
  mode: "create" | "edit";
  onRegisterCloseSaveRequest: (fn: () => CloseSaveRequest) => void;
  /** Trigger the save flow (builds close-save request and processes it). */
  onSave: () => void;
  /** Close without saving. When provided, the form shows its own Save/Cancel buttons. */
  onCancel?: () => void;
  onDelete: () => void;
  open: boolean;
  readOnly?: boolean;
  readOnlyReason?: string | null;
  headerContent?: ReactNode;
  onRegisterCreateInterop?: (interop: CalendarCreateFormInterop | null) => void;
}) {
  const isCreateMode = mode === "create";
  // Delete hotkey - only active when popover is open in edit mode, skips text inputs
  // Uses "backspace" for Mac compatibility (Mac's delete key = backspace)
  useHotkeys(
    "backspace, delete",
    (e) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      // Skip if focused on text input or textarea
      if (tagName === "input" || tagName === "textarea") {
        return;
      }
      e.preventDefault();
      onDelete();
    },
    { enabled: open && !isCreateMode && !readOnly },
    [onDelete, open, isCreateMode, readOnly]
  );
  /**
   * We intentionally do not run mutations from inside the form.
   * The popover wrapper controls “save on close” and dialogs.
   */
  const hasUserEditedRef = useRef(false);
  const onRegisterCloseSaveRequestRef = useRef(onRegisterCloseSaveRequest);
  onRegisterCloseSaveRequestRef.current = onRegisterCloseSaveRequest;
  const onRegisterCreateInteropRef = useRef(onRegisterCreateInterop);
  onRegisterCreateInteropRef.current = onRegisterCreateInterop;

  // Only query for recurring event master in edit mode when event exists
  const masterQuery = useRecurringEventMaster({
    accountId,
    calendarId,
    event: event ?? (null as GoogleEvent | null),
    enabled: open,
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

  const recurrenceSource = useMemo(
    () =>
      event?.recurrence?.length
        ? event.recurrence
        : (masterQuery.data?.recurrence ?? []),
    [event?.recurrence, masterQuery.data?.recurrence]
  );

  const initialValues = useMemo<EventFormValues>(
    () => ({
      summary: event?.summary ?? "",
      description: event?.description ?? "",
      location: event?.location ?? "",
      colorId: event?.colorId ?? undefined,
      allDay: isAllDay,
      startDate: initialStartDate ?? null,
      endDate: initialEndDate ?? null,
      startTime: isAllDay ? "" : formatTimeString(initialStartDate),
      endTime: isAllDay ? "" : formatTimeString(initialEndDate),
      recurrence: recurrenceSource,
      selectedAccountId: accountId,
      selectedCalendarId: calendarId,
    }),
    [
      accountId,
      calendarId,
      event?.colorId,
      event?.description,
      event?.location,
      event?.summary,
      recurrenceSource,
      initialEndDate,
      initialStartDate,
      isAllDay,
    ]
  );

  const { control, reset, setValue, getValues } = useForm<EventFormValues>({
    defaultValues: initialValues,
  });
  const [pendingConference, setPendingConference] = useState<
    GoogleEvent["conferenceData"] | null
  >(null);
  const pendingConferenceRef = useRef<GoogleEvent["conferenceData"] | null>(
    null
  );
  const [locationOpen, setLocationOpen] = useState(false);

  // Keep form synced if event changes underneath.
  useEffect(() => {
    // Reset “edited” tracking when the underlying event changes.
    hasUserEditedRef.current = false;
    pendingConferenceRef.current = null;
    setPendingConference(null);
    reset(initialValues, { keepDirty: false });
  }, [initialValues, reset]);

  const rawWatched = useWatch({ control });
  const watchedValues = resolveWatchedDefaults(rawWatched);
  const locationQuery = watchedValues.location.trim();
  const locationSearch = useLocationSearch(locationQuery);
  const locationSuggestions = locationSearch.data ?? [];
  const isLocationSearching = locationSearch.isFetching;

  const meetingSource = useMemo(
    () => ({
      ...(event ?? {}),
      location: watchedValues.location,
      description: watchedValues.description,
      // Use pendingConference state (not ref) to ensure memo recomputes on changes
      conferenceData: pendingConference ?? event?.conferenceData,
    }),
    [
      event,
      pendingConference,
      watchedValues.description,
      watchedValues.location,
    ]
  );
  const meetingLink = useMemo(
    () => extractMeetingLink(meetingSource),
    [meetingSource]
  );
  const isConferencePending = Boolean(
    (pendingConferenceRef.current ?? pendingConference)?.createRequest
  );
  const canCreateMeeting = !(meetingLink || isConferencePending);
  const mapsUrl = locationQuery ? getMapsSearchUrl(locationQuery) : null;
  const locationPopoverOpen = locationOpen && locationQuery.length >= 2;

  // Use the form's selected calendar (falls back to props on initial render)
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
            label: c.calendar.summary ?? "Calendar",
            color: pastelizeColor(c.calendar.backgroundColor),
          });
        }
        return acc;
      }, []),
    [accountId, calendars, isCreateMode]
  );

  // Find the active calendar for fallback color display
  const calendar = calendars.find(
    (c) =>
      c.accountId === effectiveAccountId &&
      c.calendar.id === effectiveCalendarId
  );
  // Pastelise the calendar's background color for consistency with event colors
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
        return { start: nextStart, end: nextEnd };
      }
      if (nextEnd < nextStart) {
        return { start: nextStart, end: nextStart };
      }
      return { start: nextStart, end: nextEnd };
    },
    []
  );

  const handleTimeChange = (field: "startTime" | "endTime", value: string) => {
    if (readOnly) {
      return;
    }
    if (!value) {
      hasUserEditedRef.current = true;
      setValue(field, "", { shouldDirty: true });
      return;
    }
    const [hours, minutes] = value.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return;
    }

    hasUserEditedRef.current = true;
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
      hasUserEditedRef.current = true;
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
      hasUserEditedRef.current = true;
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
    hasUserEditedRef.current = true;
    const nextConference = buildGoogleMeetConferenceData();
    pendingConferenceRef.current = nextConference;
    setPendingConference(nextConference);
    if (!isCreateMode) {
      onSave();
    }
  }, [canCreateMeeting, isCreateMode, onSave, readOnly]);

  const buildCloseSaveRequest = useCallback(
    (values: EventFormValues): CloseSaveRequest => {
      if (readOnly) {
        return { type: "none" };
      }
      const resolvedConference =
        pendingConferenceRef.current ?? pendingConference;
      if (isCreateMode) {
        return buildCreatePayload(
          values,
          clampToStartIfNeeded,
          resolvedConference,
          calendar?.calendar.timeZone
        );
      }
      return buildEditPayload(values, {
        accountId,
        calendarId,
        calendarTimeZone: calendar?.calendar.timeZone,
        clampToStartIfNeeded,
        conferenceData: resolvedConference ?? event?.conferenceData,
        event,
        hasEdits: hasUserEditedRef.current,
        masterRecurrence: masterQuery.data?.recurrence,
      });
    },
    [
      accountId,
      calendarId,
      clampToStartIfNeeded,
      event,
      isCreateMode,
      calendar?.calendar.timeZone,
      masterQuery.data,
      pendingConference,
      readOnly,
    ]
  );

  useEffect(() => {
    onRegisterCloseSaveRequestRef.current(() =>
      buildCloseSaveRequest(getValues())
    );
  }, [buildCloseSaveRequest, getValues]);

  const applySharedFields = useCallback(
    (fields: CalendarCreateSharedFields) => {
      const nextStartDate = fields.startDate ?? null;
      const nextStartTime = fields.startTime;
      const nextEnd = buildSharedEndFields(
        nextStartDate,
        nextStartTime,
        fields.durationMinutes
      );

      hasUserEditedRef.current = true;
      pendingConferenceRef.current = null;
      setPendingConference(null);
      setValue("summary", fields.title, { shouldDirty: true });
      setValue("description", fields.description, { shouldDirty: true });
      setValue("startDate", nextStartDate, { shouldDirty: true });
      setValue("endDate", nextEnd.endDate, { shouldDirty: true });
      setValue("startTime", nextStartTime, { shouldDirty: true });
      setValue("endTime", nextEnd.endTime, { shouldDirty: true });
      setValue("allDay", false, { shouldDirty: true });
      setValue("location", "", { shouldDirty: true });
      setValue("colorId", undefined, { shouldDirty: true });
      setValue("recurrence", [], { shouldDirty: true });
    },
    [setValue]
  );

  const getSharedFields = useCallback(
    () => getSharedFieldsFromEventValues(getValues()),
    [getValues]
  );

  useEffect(() => {
    if (!onRegisterCreateInteropRef.current) {
      return;
    }

    onRegisterCreateInteropRef.current({
      applySharedFields,
      getSharedFields,
    });

    return () => {
      onRegisterCreateInteropRef.current?.(null);
    };
  }, [applySharedFields, getSharedFields]);

  const startTimeValue = watchedValues.allDay ? "" : watchedValues.startTime;
  const endTimeValue = watchedValues.allDay ? "" : watchedValues.endTime;
  const recurrenceRule = watchedValues.recurrence?.[0];
  // In create mode, always allow recurrence editing. In edit mode, only if the event is recurring.
  const canEditRecurrence =
    isCreateMode ||
    Boolean(
      event?.recurrence?.length ||
        event?.recurringEventId ||
        masterQuery.data?.recurrence?.length
    );

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
          hasUserEditedRef.current = true;
          setValue("colorId", colorKey, { shouldDirty: true });
        }}
        onSummaryChange={(value) => {
          hasUserEditedRef.current = true;
          setValue("summary", value, { shouldDirty: true });
        }}
        readOnly={readOnly}
        selectedColorId={watchedValues.colorId}
        summary={watchedValues.summary}
      />

      <Textarea
        onChange={(e) => {
          hasUserEditedRef.current = true;
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
            hasUserEditedRef.current = true;
            setValue("selectedAccountId", opt.accountId, {
              shouldDirty: true,
            });
            setValue("selectedCalendarId", opt.calendarId, {
              shouldDirty: true,
            });
          }
        }}
        onRecurrenceChange={(rule) => {
          hasUserEditedRef.current = true;
          setValue("recurrence", rule ? [rule] : [], { shouldDirty: true });
        }}
        onToggleAllDay={() => {
          hasUserEditedRef.current = true;
          setValue("allDay", !watchedValues.allDay, { shouldDirty: true });
        }}
        readOnly={readOnly}
        recurrenceRule={recurrenceRule}
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
                        month: "short",
                        day: "numeric",
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
                    hasUserEditedRef.current = true;
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
                        month: "short",
                        day: "numeric",
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
                    hasUserEditedRef.current = true;
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
        />
      ) : null}
    </div>
  );
}
