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
} from "@kompose/state/meeting";
import { useAtomValue } from "jotai";
import {
  CalendarIcon,
  Check,
  Clock3,
  MapPin,
  Palette,
  Repeat,
  Timer,
  Trash2,
  Video,
} from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
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
import {
  formatPlainDate,
  formatTimeString,
  pickerDateToTemporal,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import {
  buildRecurrenceRule,
  buildTemporalPayload,
  type Frequency,
  parseRecurrence,
  type RecurrenceEnd,
  untilInputToRule,
  untilRuleToInput,
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

  useEffect(() => {
    const end = buildEndFromValues(values);
    const nextRule = buildRecurrenceRule(values.freq, values.byDay, end);
    const normalizedNext = nextRule ?? null;
    if (normalizedNext === lastEmittedRuleRef.current) {
      return;
    }
    lastEmittedRuleRef.current = normalizedNext;
    onChange(nextRule);
  }, [onChange, values, buildEndFromValues]);

  if (!visible) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Repeat className="h-4 w-4" />
          <span>Recurrence</span>
        </div>
        {recurrenceRule ? (
          <span className="truncate text-[10px] text-muted-foreground">
            {recurrenceRule}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs">Frequency</Label>
        <select
          className="h-8 rounded-md border px-2 text-xs"
          onChange={(e) => {
            const nextFreq = (e.target.value as Frequency) || "none";
            setValue("freq", nextFreq);
            if (nextFreq !== "WEEKLY") {
              // Weekday selection only applies to weekly recurrence.
              setValue("byDay", []);
            }
          }}
          value={values.freq}
        >
          <option value="none">None</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </select>
      </div>

      {values.freq === "WEEKLY" && (
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const active = values.byDay.includes(day.value);
            return (
              <Button
                key={day.value}
                onClick={() => {
                  const current = values.byDay;
                  const next = active
                    ? current.filter((d) => d !== day.value)
                    : [...current, day.value];
                  setValue("byDay", next);
                }}
                size="sm"
                type="button"
                variant={active ? "secondary" : "outline"}
              >
                {day.label}
              </Button>
            );
          })}
        </div>
      )}

      <div className="space-y-2 rounded-md border border-dashed p-3">
        <Label className="text-xs">End</Label>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setValue("endType", "none");
              setValue("untilRule", "");
            }}
            size="sm"
            type="button"
            variant={values.endType === "none" ? "secondary" : "outline"}
          >
            No end
          </Button>
          <Button
            onClick={() => {
              const fallback =
                values.untilRule ||
                untilInputToRule(
                  `${new Date().toISOString().slice(0, 10)}T00:00`
                ) ||
                `${new Date().toISOString().slice(0, 10)}T000000Z`;
              setValue("endType", "until");
              setValue("untilRule", fallback);
            }}
            size="sm"
            type="button"
            variant={values.endType === "until" ? "secondary" : "outline"}
          >
            On date
          </Button>
          <Button
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
            variant={values.endType === "count" ? "secondary" : "outline"}
          >
            After N
          </Button>
        </div>

        {values.endType === "until" ? (
          <Input
            className="w-44 text-xs"
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                setValue("untilRule", "");
                setValue("endType", "none");
                return;
              }
              const normalized = untilInputToRule(val);
              if (!normalized) {
                return;
              }
              setValue("untilRule", normalized);
            }}
            type="datetime-local"
            value={values.untilRule ? untilRuleToInput(values.untilRule) : ""}
          />
        ) : null}

        {values.endType === "count" ? (
          <div className="flex items-center gap-2">
            <Input
              className="w-20 text-xs"
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
            <span className="text-muted-foreground text-xs">occurrences</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Temporal / calendar helpers live in `event-edit-utils.ts`.

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

  // Delete state for recurring events (scope dialog)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<RecurrenceScope>("this");
  // Delete state for non-recurring events (simple confirmation)
  const [simpleDeleteConfirmOpen, setSimpleDeleteConfirmOpen] = useState(false);

  /**
   * The form registers a function that builds a save request synchronously.
   * This lets the popover close immediately, then we can show dialogs / mutate.
   */
  const buildCloseSaveRequestRef = useRef<(() => CloseSaveRequest) | null>(
    null
  );

  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<{
    variables: UpdateGoogleEventInput;
    defaultScope: RecurrenceScope;
    hasDataEdits: boolean;
    calendarChanged?: { destinationCalendarId: string };
  } | null>(null);
  const [selectedScope, setSelectedScope] = useState<RecurrenceScope>("this");

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
    setPendingSave(null);
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
    if (!event) {
      return;
    }
    setOpen(false);
    // Show scope dialog for recurring events
    if (event.recurringEventId || event.recurrence?.length) {
      const defaultScope = event.recurringEventId ? "this" : "all";
      setDeleteScope(defaultScope);
      setDeleteDialogOpen(true);
    } else {
      // Non-recurring: show simple confirmation
      setSimpleDeleteConfirmOpen(true);
    }
  }, [event, setOpen]);

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
    setSimpleDeleteConfirmOpen(false);
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

  const handleClose = useCallback(() => {
    const request = buildCloseSaveRequestRef.current?.() ?? { type: "none" };
    setOpen(false);

    if (request.type === "none") {
      return;
    }

    // Handle create mode
    if (request.type === "create") {
      createEvent.mutate(request.payload);
      return;
    }

    if (request.type === "save") {
      // Recurring events: show scope dialog (applies to both save and move)
      if (request.isRecurring) {
        // Google API doesn't allow moving individual recurring instances,
        // so force scope to "all" when a calendar move is pending.
        const forceAll = Boolean(request.calendarChanged);
        const scope = forceAll ? "all" : request.defaultScope;
        setPendingSave({
          variables: request.variables,
          defaultScope: scope,
          hasDataEdits: request.hasDataEdits,
          calendarChanged: request.calendarChanged,
        });
        setSelectedScope(scope);
        setScopeDialogOpen(true);
        return;
      }

      // Non-recurring: save directly, then move if calendar changed
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
    setOpen,
    updateEvent,
  ]);

  return (
    <>
      <Popover
        onOpenChange={(nextOpen) => {
          // When closing, build a save request *before* the form unmounts.
          if (!nextOpen) {
            handleClose();
            return;
          }
          setOpen(true);
        }}
        open={open}
      >
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-[420px] space-y-3 p-4"
          side={side}
        >
          <EventEditForm
            accountId={accountId}
            calendarId={calendarId}
            end={end}
            event={event}
            mode={mode}
            onDelete={handleDelete}
            onRegisterCloseSaveRequest={(fn) => {
              buildCloseSaveRequestRef.current = fn;
            }}
            onRequestClose={() => handleClose()}
            open={open}
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
        onCancel={() => {
          setPendingSave(null);
        }}
        onConfirm={commitPendingSave}
        onOpenChange={setScopeDialogOpen}
        onValueChange={setSelectedScope}
        open={scopeDialogOpen}
        title="Save recurring event changes"
        value={selectedScope}
      />

      {/* Delete scope dialog for recurring events */}
      <RecurrenceScopeDialog
        confirmLabel="Delete"
        description="Choose how broadly to apply the deletion."
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={commitDelete}
        onOpenChange={setDeleteDialogOpen}
        onValueChange={setDeleteScope}
        open={deleteDialogOpen}
        title="Delete recurring event"
        value={deleteScope}
      />

      {/* Simple delete confirmation for non-recurring events */}
      <AlertDialog
        onOpenChange={setSimpleDeleteConfirmOpen}
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

function EventEditForm({
  event,
  accountId,
  calendarId,
  start,
  end,
  mode,
  onRegisterCloseSaveRequest,
  onRequestClose,
  onDelete,
  open,
}: {
  event?: GoogleEvent;
  accountId: string;
  calendarId: string;
  start: Date;
  end: Date;
  mode: "create" | "edit";
  onRegisterCloseSaveRequest: (fn: () => CloseSaveRequest) => void;
  onRequestClose: () => void;
  onDelete: () => void;
  open: boolean;
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
    { enabled: open && !isCreateMode },
    [onDelete, open, isCreateMode]
  );
  /**
   * We intentionally do not run mutations from inside the form.
   * The popover wrapper controls “save on close” and dialogs.
   */
  const hasUserEditedRef = useRef(false);

  // Only query for recurring event master in edit mode when event exists
  const masterQuery = useRecurringEventMaster({
    accountId,
    calendarId,
    event: event ?? (null as GoogleEvent | null),
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
      startTime: isAllDay
        ? ""
        : formatTimeString(initialStartDate ?? new Date()),
      endTime: isAllDay ? "" : formatTimeString(initialEndDate ?? new Date()),
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

  const watchedValues = useWatch({ control });
  const locationQuery = watchedValues.location?.trim() ?? "";
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

  useEffect(() => {
    if (locationQuery.length < 2 && locationOpen) {
      setLocationOpen(false);
    }
  }, [locationOpen, locationQuery.length]);

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
      calendars
        .filter(
          (c) =>
            c.calendar.accessRole === "writer" ||
            c.calendar.accessRole === "owner"
        )
        .filter((c) => isCreateMode || c.accountId === accountId)
        .map((c) => ({
          accountId: c.accountId,
          calendarId: c.calendar.id,
          label: c.calendar.summary ?? "Calendar",
        })),
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
      hasUserEditedRef.current = true;
      setValue("location", value, { shouldDirty: true });
      if (value.trim().length >= 2) {
        setLocationOpen(true);
      } else {
        setLocationOpen(false);
      }
    },
    [setValue]
  );

  const handleLocationValueChange = useCallback(
    (value: string | null) => {
      if (!value) {
        return;
      }
      hasUserEditedRef.current = true;
      setValue("location", value, { shouldDirty: true });
      setLocationOpen(false);
    },
    [setValue]
  );

  const handleLocationOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setLocationOpen(false);
        return;
      }
      if (locationQuery.length >= 2) {
        setLocationOpen(true);
      }
    },
    [locationQuery.length]
  );

  const handleCreateMeeting = useCallback(() => {
    if (!canCreateMeeting) {
      return;
    }
    hasUserEditedRef.current = true;
    const nextConference = buildGoogleMeetConferenceData();
    pendingConferenceRef.current = nextConference;
    setPendingConference(nextConference);
    if (!isCreateMode) {
      onRequestClose();
    }
  }, [canCreateMeeting, isCreateMode, onRequestClose]);

  const buildCreateCloseSaveRequest = useCallback(
    (values: EventFormValues): CloseSaveRequest => {
      const trimmedTitle = values.summary.trim();
      if (!trimmedTitle) {
        return { type: "none" };
      }

      const temporalPayload = buildTemporalPayload(
        values,
        clampToStartIfNeeded
      );
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
            conferenceData:
              pendingConferenceRef.current ?? pendingConference ?? undefined,
            start: temporalPayload.startPayload,
            end: temporalPayload.endPayload,
          },
        },
      };
    },
    [clampToStartIfNeeded, pendingConference]
  );

  const buildEditCloseSaveRequest = useCallback(
    (values: EventFormValues): CloseSaveRequest => {
      // Detect if the user moved the event to a different calendar
      const calendarChanged = values.selectedCalendarId !== calendarId;
      const hasEdits = hasUserEditedRef.current;

      // Nothing to do if no data edits and calendar didn't change
      if (!(hasEdits || calendarChanged)) {
        return { type: "none" };
      }

      const temporalPayload = buildTemporalPayload(
        values,
        clampToStartIfNeeded
      );
      if (!temporalPayload) {
        return { type: "none" };
      }

      const isRecurring = Boolean(
        event?.recurringEventId ||
          event?.recurrence?.length ||
          masterQuery.data?.recurrence?.length
      );
      const defaultScope: RecurrenceScope = event?.recurringEventId
        ? "this"
        : "all";
      const conferenceData =
        pendingConferenceRef.current ??
        pendingConference ??
        event?.conferenceData;

      // Prepare payload for mutation; recurrence scope is chosen after close.
      const variables: UpdateGoogleEventInput = {
        accountId,
        calendarId,
        eventId: event?.id ?? "",
        event: {
          ...event,
          id: event?.id ?? "",
          summary: values.summary.trim(),
          description: values.description ?? "",
          location: values.location ?? "",
          colorId: values.colorId ?? undefined,
          recurrence: values.recurrence ?? event?.recurrence,
          conferenceData: conferenceData ?? undefined,
          start: {
            ...event?.start,
            ...temporalPayload.startPayload,
          },
          end: {
            ...event?.end,
            ...temporalPayload.endPayload,
          },
        },
      };

      return {
        type: "save",
        variables,
        isRecurring,
        defaultScope,
        hasDataEdits: hasEdits,
        calendarChanged: calendarChanged
          ? { destinationCalendarId: values.selectedCalendarId }
          : undefined,
      };
    },
    [
      accountId,
      calendarId,
      clampToStartIfNeeded,
      event,
      masterQuery.data,
      pendingConference,
    ]
  );

  const buildCloseSaveRequest = useCallback(
    (values: EventFormValues): CloseSaveRequest =>
      isCreateMode
        ? buildCreateCloseSaveRequest(values)
        : buildEditCloseSaveRequest(values),
    [buildCreateCloseSaveRequest, buildEditCloseSaveRequest, isCreateMode]
  );

  // Register close-save callback so the popover can decide what to do on close.
  useEffect(() => {
    onRegisterCloseSaveRequest(() => {
      // This is called by the popover wrapper right before it closes.
      return buildCloseSaveRequest(getValues());
    });
  }, [buildCloseSaveRequest, getValues, onRegisterCloseSaveRequest]);

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
    <form
      className="space-y-3"
      onSubmit={(e) => {
        // This form is saved from the popover wrapper (on close / action),
        // so the inline submit should never do anything.
        e.preventDefault();
      }}
    >
      <div className="flex items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-label="Pick color"
              className={cn(
                "h-8 w-8 rounded-full border-2 shadow-sm transition",
                watchedValues.colorId ? "border-transparent" : "border-muted"
              )}
              style={{
                background:
                  colorEntries.find(
                    ([key]) => key === watchedValues.colorId
                  )?.[1]?.background ??
                  calendarFallbackColor ??
                  undefined,
              }}
              type="button"
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[220px]">
            <div className="flex flex-wrap gap-2">
              {colorEntries.map(([colorKey, palette]) => {
                const isSelected = watchedValues.colorId === colorKey;
                return (
                  <button
                    aria-label={`Color ${colorKey}`}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition",
                      isSelected ? "ring-2 ring-primary ring-offset-2" : ""
                    )}
                    key={colorKey}
                    onClick={(e) => {
                      e.preventDefault();
                      hasUserEditedRef.current = true;
                      setValue("colorId", colorKey, { shouldDirty: true });
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
                className="h-7 w-7 p-0 text-[10px]"
                onClick={() => {
                  hasUserEditedRef.current = true;
                  setValue("colorId", undefined, { shouldDirty: true });
                }}
                type="button"
                variant="ghost"
              >
                <Palette className="h-4 w-4" />
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Input
          autoFocus={isCreateMode}
          className="flex-1"
          onChange={(e) => {
            hasUserEditedRef.current = true;
            setValue("summary", e.target.value, { shouldDirty: true });
          }}
          placeholder={isCreateMode ? "Event title (required)" : "Event title"}
          value={watchedValues.summary}
        />
      </div>

      <Textarea
        onChange={(e) => {
          hasUserEditedRef.current = true;
          setValue("description", e.target.value, { shouldDirty: true });
        }}
        placeholder="Add details..."
        value={watchedValues.description}
      />

      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Meeting
        </Label>
        {meetingLink ? (
          <Button asChild size="sm" type="button" variant="outline">
            <a href={meetingLink.url} rel="noreferrer" target="_blank">
              <Video className="h-3 w-3" />
              Join {meetingLink.label}
            </a>
          </Button>
        ) : isConferencePending ? (
          <div className="text-muted-foreground text-xs">
            Google Meet will be created when you save.
          </div>
        ) : (
          <Button
            onClick={handleCreateMeeting}
            size="sm"
            type="button"
            variant="outline"
          >
            <Video className="h-3 w-3" />
            Add Google Meet
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Location
        </Label>
        <Combobox
          inputValue={watchedValues.location}
          onInputValueChange={handleLocationInputChange}
          onOpenChange={handleLocationOpenChange}
          onValueChange={handleLocationValueChange}
          open={locationPopoverOpen}
        >
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ComboboxInput
                className="w-full"
                onFocus={() => {
                  if (locationQuery.length >= 2) {
                    setLocationOpen(true);
                  }
                }}
                placeholder="Where?"
                showClear={Boolean(watchedValues.location)}
              />
            </div>
            {mapsUrl ? (
              <Button asChild size="icon" type="button" variant="outline">
                <a href={mapsUrl} rel="noreferrer" target="_blank">
                  <MapPin className="h-3 w-3" />
                  <span className="sr-only">Open in Google Maps</span>
                </a>
              </Button>
            ) : null}
          </div>
          <ComboboxContent align="start" sideOffset={6}>
            <ComboboxList>
              {locationSuggestions.map((suggestion) => (
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
                {isLocationSearching ? "Searching…" : "No matches found."}
              </ComboboxEmpty>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        {/* All-day toggle button with checkbox indicator */}
        <Button
          className="gap-2 text-xs"
          onClick={() => {
            hasUserEditedRef.current = true;
            setValue("allDay", !watchedValues.allDay, { shouldDirty: true });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {/* Checkbox indicator */}
          <div
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded border transition-colors",
              watchedValues.allDay
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/50 bg-transparent"
            )}
          >
            {watchedValues.allDay ? <Check className="h-3 w-3" /> : null}
          </div>
          All day
        </Button>
        <div className="flex items-center gap-2">
          {/* Recurrence editor - available in create mode and for recurring events in edit mode */}
          {canEditRecurrence ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button className="h-8 w-8" size="icon" variant="outline">
                  <Repeat className="h-4 w-4" />
                  <span className="sr-only">Edit recurrence</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[360px]">
                <RecurrenceEditor
                  onChange={(rule) => {
                    hasUserEditedRef.current = true;
                    setValue("recurrence", rule ? [rule] : [], {
                      shouldDirty: true,
                    });
                  }}
                  recurrenceRule={recurrenceRule}
                  visible
                />
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>

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
                  variant="outline"
                >
                  <CalendarIcon className="h-4 w-4" />
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
                  variant="outline"
                >
                  <CalendarIcon className="h-4 w-4" />
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
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className={cn(
                  "justify-start gap-2 text-left font-medium text-xs",
                  !startTimeValue && "text-muted-foreground"
                )}
                variant="outline"
              >
                <Clock3 className="h-4 w-4" />
                {startTimeValue || "Start time"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[220px]">
              <Label className="text-muted-foreground text-xs">
                Start time
              </Label>
              <Input
                className="mt-2"
                onChange={(e) => handleTimeChange("startTime", e.target.value)}
                step={900}
                type="time"
                value={startTimeValue}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                className={cn(
                  "justify-start gap-2 text-left font-medium text-xs",
                  !endTimeValue && "text-muted-foreground"
                )}
                variant="outline"
              >
                <Timer className="h-4 w-4" />
                {endTimeValue || "End time"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[220px]">
              <Label className="text-muted-foreground text-xs">End time</Label>
              <Input
                className="mt-2"
                onChange={(e) => handleTimeChange("endTime", e.target.value)}
                step={900}
                type="time"
                value={endTimeValue}
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Calendar picker (both modes) — replaces the Move dialog in edit mode */}
      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Calendar
        </Label>
        <Select
          onValueChange={(val) => {
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
          value={`${effectiveAccountId}::${effectiveCalendarId}`}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select calendar" />
          </SelectTrigger>
          <SelectContent>
            {calendarPickerOptions.map((c) => (
              <SelectItem
                key={`${c.accountId}::${c.calendarId}`}
                value={`${c.accountId}::${c.calendarId}`}
              >
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Delete button - only in edit mode */}
      {isCreateMode ? null : (
        <>
          <Separator />
          <Button
            className="w-full gap-2 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={onDelete}
            type="button"
            variant="outline"
          >
            <Trash2 className="h-4 w-4" />
            Delete event
          </Button>
        </>
      )}
    </form>
  );
}
