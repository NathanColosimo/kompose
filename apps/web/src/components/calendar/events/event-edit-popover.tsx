"use client";

import type { CreateEventInput } from "@kompose/api/routers/google-cal/contract";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
} from "@kompose/state/atoms/google-colors";
import { googleCalendarsDataAtom } from "@kompose/state/atoms/google-data";
import {
  describeEventRecurrence,
  monthlyDayOptions,
} from "@kompose/state/event-recurrence-words";
import { canWriteCalendar } from "@kompose/state/google-event-editability";
import {
  buildGoogleEventRecurrenceRule,
  type EventRecurrencePattern,
  type EventRecurrenceFrequency as Frequency,
  getPrimaryRecurrenceRule,
  parseGoogleEventRecurrenceRule,
  pickRecurrenceFrequency,
  recurrenceEndDay,
  recurrenceUntilValue,
  repeatChanged,
  setPrimaryRecurrenceRule,
  untilDefaultDay,
  weekdayCodeOf,
  weekOrdered,
} from "@kompose/state/google-event-recurrence";
import { withEditedTime } from "@kompose/state/google-event-times";
import {
  EVENT_CREATE_FAILURE_MESSAGE,
  SAVE_FAILURE_MESSAGE,
} from "@kompose/state/held-save";
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
import {
  chosenScope,
  type EventSaveChanges,
  eventSaveDescription,
  eventSaveDisabledScopes,
  RECURRENCE_SCOPE_OPTIONS,
  SCOPE_DIALOG_COPY,
} from "@kompose/state/recurrence-scope-options";
import {
  formatAllDayWhen,
  formatEventWhen,
  moveEventStart,
} from "@kompose/state/temporal-utils";
import { useAtomValue, useSetAtom } from "jotai";
import {
  CalendarIcon,
  Check,
  Lock,
  MapPin,
  Palette,
  Repeat,
  Trash2,
  Video,
} from "lucide-react";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Controller,
  type UseFormSetValue,
  useForm,
  useWatch,
} from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { Temporal } from "temporal-polyfill";
import {
  RecurrenceScopeDialog,
  type ScopeDialogSubject,
} from "@/components/recurrence-scope-dialog";
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
import {
  HeldFieldset,
  SaveFailure,
  SavingLabel,
} from "@/components/ui/held-fieldset";
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
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";
import type {
  CalendarCreateFormInterop,
  CalendarCreateSharedFields,
} from "../event-creation/create-form-shared";
import {
  buildTemporalPayload,
  eventForScope,
  saveFacts,
  WEEKDAYS,
} from "./event-edit-utils";
import { recurringDeleteAtom } from "./recurring-delete-dialog";

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
  description: string;
  endDate: Date | null;
  endTime: string;
  location: string;
  recurrence: string[];
  selectedAccountId: string;
  selectedCalendarId: string;
  startDate: Date | null;
  startTime: string;
  summary: string;
}

/**
 * What a save changes for the scopes the dialog offers (`saveFacts`),
 * worked out each render from the pending edit and the series as loaded
 * now, so a series that loads after Save counts.
 */
type ScopeFacts = ReturnType<typeof saveFacts>;

/**
 * What a pending save changes, for the scopes the dialog offers. Whether
 * the series' rule is in is read live, so an open dialog updates when it
 * loads.
 */
function saveChanges(
  pendingSave: Pick<PendingSave, "calendarChanged" | "patternChanged"> | null,
  facts: ScopeFacts,
  series: Pick<EventSaveChanges, "seriesRuleFailed" | "seriesRuleLoaded">
): EventSaveChanges {
  return {
    calendarMoved: Boolean(pendingSave?.calendarChanged),
    patternChanged: pendingSave?.patternChanged ?? false,
    ...facts,
    ...series,
  };
}

export type CloseSaveRequest =
  | { type: "none" }
  /** The form can't be saved as is (it ends before it starts): stay open. */
  | { type: "invalid" }
  | {
      type: "save";
      /**
       * Mutation payload that represents the user’s edits.
       * We keep recurrence scope out of the form and ask for it after close.
       */
      variables: UpdateGoogleEventInput;
      isRecurring: boolean;
      defaultScope: RecurrenceScope;
      /** Whether event data (non-calendar fields) were actually edited. */
      hasDataEdits: boolean;
      calendarChanged?: { destinationCalendarId: string };
      /** The repeat pattern changed: it can't apply to one occurrence. */
      patternChanged: boolean;
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

/**
 * A whole number typed freely: the draft can be empty or half-typed while
 * the field has focus; only a valid number is passed on, and leaving the
 * field shows the last one.
 */
function CountField({
  label,
  max,
  onValue,
  value,
}: {
  label: string;
  max: number;
  onValue: (value: number) => void;
  value: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      aria-label={label}
      className="h-8 w-14 px-2 text-center text-xs"
      inputMode="numeric"
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const next = e.target.value.replace(NON_DIGITS, "");
        setDraft(next);
        const parsed = Number.parseInt(next, 10);
        if (parsed >= 1 && parsed <= max) {
          onValue(parsed);
        }
      }}
      value={draft ?? String(value)}
    />
  );
}

const NON_DIGITS = /\D/g;

const UNIT_WORDS: Record<
  Exclude<Frequency, "none" | "custom">,
  [string, string]
> = {
  DAILY: ["day", "days"],
  MONTHLY: ["month", "months"],
  WEEKLY: ["week", "weeks"],
  YEARLY: ["year", "years"],
};

function RecurrenceEditor({
  allDay,
  endFrom,
  recurrenceRule,
  onChange,
  start,
  timeZone,
}: {
  /** An all-day series ends on a date; a timed one after that day. */
  allDay: boolean;
  /**
   * The day an end date defaults from and can't be before: the event's own
   * (an occurrence's, not its series' first, which can be years back).
   */
  endFrom: Temporal.PlainDate;
  recurrenceRule?: string;
  onChange: (rule: string | null) => void;
  /** The series' start: its weekday and day of the month are the defaults. */
  start: Temporal.PlainDate;
  /** The series' zone, where its end day is counted. */
  timeZone: string;
}) {
  const pattern = useMemo(
    () => parseGoogleEventRecurrenceRule(recurrenceRule),
    [recurrenceRule]
  );

  const emit = (next: EventRecurrencePattern) => {
    const nextRule = buildGoogleEventRecurrenceRule(next, recurrenceRule);
    if (nextRule !== (recurrenceRule ?? null)) {
      onChange(nextRule);
    }
  };

  const summary = recurrenceRule
    ? describeEventRecurrence({ rules: [recurrenceRule], start, timeZone })
    : null;

  return (
    <div className="space-y-3">
      {/* The rule in words, wrapping, so a long one reads in full. */}
      <div className="flex items-start gap-2 text-xs">
        <Repeat className="mt-px size-3.5 shrink-0 text-muted-foreground" />
        <span className={summary ? "" : "text-muted-foreground"}>
          {summary ?? "Doesn't repeat"}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <Select
          onValueChange={(v) =>
            emit(pickRecurrenceFrequency(pattern, v as Frequency))
          }
          value={pattern.freq}
        >
          <SelectTrigger aria-label="Repeat" className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pattern.freq === "custom" ? (
              <SelectItem disabled value="custom">
                Custom
              </SelectItem>
            ) : null}
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="DAILY">Daily</SelectItem>
            <SelectItem value="WEEKLY">Weekly</SelectItem>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
            <SelectItem value="YEARLY">Yearly</SelectItem>
          </SelectContent>
        </Select>
        {pattern.freq === "none" || pattern.freq === "custom" ? null : (
          <>
            <span className="text-muted-foreground">every</span>
            <CountField
              label="Repeat every"
              max={99}
              onValue={(interval) => emit({ ...pattern, interval })}
              value={pattern.interval}
            />
            <span className="text-muted-foreground">
              {UNIT_WORDS[pattern.freq][pattern.interval === 1 ? 0 : 1]}
            </span>
          </>
        )}
      </div>

      <RepeatDays
        emit={emit}
        pattern={pattern}
        rule={recurrenceRule}
        start={start}
      />
      {/* A series that doesn't repeat has no end to pick. */}
      {pattern.freq === "none" || pattern.freq === "custom" ? null : (
        <RepeatEnds
          allDay={allDay}
          emit={emit}
          endFrom={endFrom}
          pattern={pattern}
          start={start}
          timeZone={timeZone}
        />
      )}
    </div>
  );
}

interface RepeatPartProps {
  emit: (next: EventRecurrencePattern) => void;
  pattern: EventRecurrencePattern;
  start: Temporal.PlainDate;
}

const MON_TO_FRI = ["MO", "TU", "WE", "TH", "FR"];

/** Which days a weekly or monthly series repeats on. */
function RepeatDays({
  emit,
  pattern,
  rule,
  start,
}: RepeatPartProps & { rule: string | undefined }) {
  // Weekly with no days picked repeats on the start's weekday: show it lit.
  const shownDays =
    pattern.byDay.length > 0 ? pattern.byDay : [weekdayCodeOf(start)];
  return (
    <>
      {pattern.freq === "WEEKLY" && (
        <div className="space-y-2">
          <span className="text-muted-foreground text-xs">On days</span>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => {
              const active = shownDays.includes(day.value);
              return (
                <Button
                  aria-label={day.label}
                  aria-pressed={active}
                  className={cn(
                    "size-8 rounded-full p-0 text-xs",
                    active &&
                      "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                  key={day.value}
                  onClick={() => {
                    const byDay = active
                      ? shownDays.filter((d) => d !== day.value)
                      : weekOrdered([...shownDays, day.value]);
                    emit({ ...pattern, byDay });
                  }}
                  size="icon"
                  type="button"
                  variant={active ? "default" : "outline"}
                >
                  {day.label.slice(0, 2)}
                </Button>
              );
            })}
            {/* Every weekday in one click, as Google Calendar offers. */}
            <Button
              className="ml-auto h-8 rounded-full px-2.5 text-xs"
              onClick={() => emit({ ...pattern, byDay: MON_TO_FRI })}
              type="button"
              variant="outline"
            >
              Mon–Fri
            </Button>
          </div>
        </div>
      )}

      {pattern.freq === "MONTHLY" && (
        <div className="space-y-2">
          <span className="text-muted-foreground text-xs">On</span>
          {/* The start's day, its weekday of the month, and in its last
              week the last one; a rule set another way first. */}
          <div className="grid grid-cols-2 gap-1.5">
            {monthlyDayOptions(pattern, rule, start).map((option) => (
              <Button
                aria-pressed={option.selected}
                className="h-8 text-xs"
                key={`${option.byDay}|${option.monthDays}`}
                onClick={() =>
                  emit({
                    ...pattern,
                    byDay: option.byDay,
                    monthDays: option.monthDays,
                  })
                }
                size="sm"
                type="button"
                variant={option.selected ? "default" : "outline"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** When the series ends: never, on a date, or after a number of times. */
function RepeatEnds({
  allDay,
  emit,
  endFrom,
  pattern,
  timeZone,
}: RepeatPartProps & {
  allDay: boolean;
  endFrom: Temporal.PlainDate;
  timeZone: string;
}) {
  const [untilOpen, setUntilOpen] = useState(false);
  const untilDay =
    pattern.end.type === "until"
      ? recurrenceEndDay(pattern.end.date, timeZone)
      : null;
  const untilDate = untilDay ? temporalToPickerDate(untilDay) : undefined;
  return (
    <div className="space-y-2">
      <span className="text-muted-foreground text-xs">Ends</span>
      {/* Three equal options in one row, as on the phone; the date or
              count for the picked one goes below. */}
      <div className="grid grid-cols-3 gap-1.5">
        {RECURRENCE_ENDS.map((option) => (
          <Button
            aria-pressed={pattern.end.type === option.value}
            className="h-8 text-xs"
            key={option.value}
            onClick={() => {
              if (option.value === pattern.end.type) {
                setUntilOpen(option.value === "until");
                return;
              }
              if (option.value === "none") {
                emit({ ...pattern, end: { type: "none" } });
              } else if (option.value === "until") {
                // Three months on, opened to change at once.
                emit({
                  ...pattern,
                  end: {
                    date: recurrenceUntilValue(
                      untilDefaultDay(endFrom, timeZone),
                      allDay,
                      timeZone
                    ),
                    type: "until",
                  },
                });
                setUntilOpen(true);
              } else {
                emit({ ...pattern, end: { count: 10, type: "count" } });
              }
            }}
            size="sm"
            type="button"
            variant={pattern.end.type === option.value ? "default" : "outline"}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {pattern.end.type === "until" ? (
        <Popover onOpenChange={setUntilOpen} open={untilOpen}>
          <PopoverTrigger asChild>
            <Button
              className="h-8 gap-1.5 px-2 text-xs"
              type="button"
              variant="outline"
            >
              <CalendarIcon className="size-3.5" />
              {untilDay
                ? formatPlainDate(untilDay, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              defaultMonth={untilDate}
              // A series can't end before it starts (from here).
              disabled={{ before: temporalToPickerDate(endFrom) }}
              mode="single"
              onSelect={(date) => {
                if (date) {
                  emit({
                    ...pattern,
                    end: {
                      date: recurrenceUntilValue(
                        pickerDateToTemporal(date),
                        allDay,
                        timeZone
                      ),
                      type: "until",
                    },
                  });
                  setUntilOpen(false);
                }
              }}
              selected={untilDate}
            />
          </PopoverContent>
        </Popover>
      ) : null}

      {pattern.end.type === "count" ? (
        <div className="flex items-center gap-2 text-xs">
          <CountField
            label="Occurrences"
            max={MAX_OCCURRENCES}
            onValue={(count) =>
              emit({ ...pattern, end: { count, type: "count" } })
            }
            value={pattern.end.count}
          />
          <span className="text-muted-foreground">
            {pattern.end.count === 1 ? "time" : "times"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Google Calendar's editor takes at most this many occurrences. */
const MAX_OCCURRENCES = 730;

const RECURRENCE_ENDS = [
  { label: "Never", value: "none" },
  { label: "On date", value: "until" },
  { label: "After", value: "count" },
] as const;

/** A recurring event's save, waiting for its scope. */
type PendingSave = Omit<
  Extract<CloseSaveRequest, { type: "save" }>,
  "isRecurring" | "type"
>;

interface EventEditDialogState {
  pendingSave: PendingSave | null;
  scopeDialogOpen: boolean;
  /** The user's own pick in the scope dialog; null until they pick. */
  selectedScope: RecurrenceScope | null;
  simpleDeleteConfirmOpen: boolean;
}

type EventEditDialogAction =
  | { type: "open-simple-delete" }
  | { type: "set-simple-delete-open"; value: boolean }
  | {
      type: "open-scope-dialog";
      pendingSave: EventEditDialogState["pendingSave"];
    }
  | { type: "set-scope-dialog-open"; value: boolean }
  | { type: "set-selected-scope"; value: RecurrenceScope };

const eventEditDialogInitialState: EventEditDialogState = {
  pendingSave: null,
  scopeDialogOpen: false,
  selectedScope: null,
  simpleDeleteConfirmOpen: false,
};

function eventEditDialogReducer(
  state: EventEditDialogState,
  action: EventEditDialogAction
): EventEditDialogState {
  switch (action.type) {
    case "open-simple-delete":
      return { ...state, simpleDeleteConfirmOpen: true };
    case "set-simple-delete-open":
      return { ...state, simpleDeleteConfirmOpen: action.value };
    case "open-scope-dialog":
      return {
        ...state,
        pendingSave: action.pendingSave,
        scopeDialogOpen: true,
        selectedScope: null,
      };
    case "set-scope-dialog-open":
      return { ...state, scopeDialogOpen: action.value };
    case "set-selected-scope":
      return { ...state, selectedScope: action.value };
    default:
      return action satisfies never;
  }
}

/** The element with focus, if it's one focus can return to. */
function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
}

function heldFailure(error: unknown, fallback: string): string {
  return error instanceof SavedNotMovedError ? error.message : fallback;
}

/** The edits saved, but the move to another calendar that followed didn't. */
class SavedNotMovedError extends Error {
  constructor(cause: unknown) {
    super(
      "Saved your changes, but couldn't move the event to the other calendar. Save to try again.",
      { cause }
    );
  }
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
  const setRecurringDelete = useSetAtom(recurringDeleteAtom);
  const moveEvent = useMoveGoogleEventMutation();
  const [dialogState, dispatchDialog] = useReducer(
    eventEditDialogReducer,
    eventEditDialogInitialState
  );
  const {
    simpleDeleteConfirmOpen,
    scopeDialogOpen,
    pendingSave,
    selectedScope,
  } = dialogState;

  // The form and scope dialog share the series query.
  const seriesMaster = useRecurringEventMaster({
    accountId,
    calendarId,
    enabled: open,
    event: event ?? null,
  });
  const seriesRuleLoaded = Boolean(
    event?.recurrence?.length || seriesMaster.ruleReady
  );
  const timeZone = useAtomValue(timezoneAtom);
  const seriesStatus = {
    seriesRuleFailed: seriesMaster.ruleFailed,
    seriesRuleLoaded,
  };

  const buildCloseSaveRequestRef = useRef<(() => CloseSaveRequest) | null>(
    null
  );

  // The editor stays open ("Saving…") until a save succeeds, so a failed
  // save keeps the edits. Escape and outside clicks wait too.
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const narrowWindow = useIsMobile();
  /** The editor's focused field when the scope dialog opened. */
  const focusBeforeScopeRef = useRef<HTMLElement | null>(null);
  /** Why the last save failed, shown beside Save until the next one. */
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  // A failure belongs to the save it came from: reopening starts clean.
  useEffect(() => {
    if (!open) {
      setSaveFailure(null);
    }
  }, [open]);
  const holdForSave = useCallback(
    (save: Promise<unknown>, failureMessage: string) => {
      savingRef.current = true;
      // The fields remount read-only (HeldFieldset), which would drop focus
      // to the page, where the calendar's keys could navigate away from the
      // save; the editor itself holds it instead.
      contentRef.current?.focus();
      setIsSaving(true);
      setSaveFailure(null);
      const settle = (failure: string | null) => {
        savingRef.current = false;
        setIsSaving(false);
        if (failure) {
          setSaveFailure(failure);
        } else {
          setOpen(false);
        }
      };
      save.then(
        () => settle(null),
        (error: unknown) => settle(heldFailure(error, failureMessage))
      );
    },
    [setOpen]
  );

  /** Write the edits, then the calendar move, both with `scope`. */
  const saveEdits = useCallback(
    async (
      edits: Pick<
        PendingSave,
        "calendarChanged" | "hasDataEdits" | "variables"
      >,
      scope: RecurrenceScope
    ) => {
      if (edits.hasDataEdits) {
        await updateEvent.mutateAsync({
          ...edits.variables,
          // Leave unchanged occurrence details out of series updates.
          event: eventForScope({
            edited: edits.variables.event,
            occurrence: event,
            scope,
          }),
          failureMessage: SAVE_FAILURE_MESSAGE,
          optimistic: false,
          // The editor says what failed, beside Save.
          quiet: true,
          recurrenceScope: scope,
        });
      }
      if (edits.calendarChanged && event) {
        const move = moveEvent.mutateAsync({
          accountId,
          calendarId,
          destinationCalendarId: edits.calendarChanged.destinationCalendarId,
          eventId: event.id,
          failureMessage: SAVE_FAILURE_MESSAGE,
          // The editor says what failed, beside Save.
          quiet: true,
          scope,
        });
        // The edits are in by now: a failed move mustn't say they aren't.
        await (edits.hasDataEdits
          ? move.catch((cause: unknown) => {
              throw new SavedNotMovedError(cause);
            })
          : move);
      }
    },
    [accountId, calendarId, event, moveEvent, updateEvent]
  );

  // The scope the save dialog shows and saves with, worked out each time
  // from the pending edit and the series as loaded now.
  const pendingFacts: ScopeFacts =
    pendingSave && event
      ? saveFacts({
          edited: pendingSave.variables.event,
          event,
          timeZone,
        })
      : { dateMoved: false };
  const saveScopeChanges = saveChanges(pendingSave, pendingFacts, seriesStatus);
  const saveDialog = {
    // Explain the choices disabled by the edit or a pending series load.
    description: eventSaveDescription(saveScopeChanges),
    disabled: eventSaveDisabledScopes(saveScopeChanges),
  };
  const saveScope = chosenScope(
    selectedScope,
    pendingSave?.defaultScope ?? "this",
    saveDialog.disabled
  );
  const commitPendingSave = useCallback(() => {
    if (!pendingSave) {
      return;
    }
    const save = saveEdits(pendingSave, saveScope);
    // The save stays pending until the next one replaces it, so the
    // dialog's words don't change as it fades.
    holdForSave(save, SAVE_FAILURE_MESSAGE);
  }, [holdForSave, pendingSave, saveEdits, saveScope]);

  const handleDelete = useCallback(() => {
    if (savingRef.current) {
      return;
    }
    if (!event) {
      return;
    }
    setOpen(false);
    if (event.recurringEventId || event.recurrence?.length) {
      const defaultScope = event.recurringEventId ? "this" : "all";
      // Asked outside this block, which a delete takes off the calendar.
      setRecurringDelete((before) => ({
        id: (before?.id ?? 0) + 1,
        open: true,
        target: { accountId, calendarId, defaultScope, event },
      }));
    } else {
      dispatchDialog({ type: "open-simple-delete" });
    }
  }, [accountId, calendarId, event, setOpen, setRecurringDelete]);

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

  const handleCancel = useCallback(() => {
    if (!savingRef.current) {
      setOpen(false);
    }
  }, [setOpen]);

  const handleSave = useCallback(() => {
    if (savingRef.current) {
      return;
    }
    const request = buildCloseSaveRequestRef.current?.() ?? { type: "none" };
    if (request.type === "invalid") {
      // The form says why (it, or its repeat, ends before it starts).
      return;
    }
    if (request.type === "none") {
      setOpen(false);
      return;
    }

    if (request.type === "create") {
      holdForSave(
        createEvent.mutateAsync({
          ...request.payload,
          failureMessage: EVENT_CREATE_FAILURE_MESSAGE,
          quiet: true,
        }),
        EVENT_CREATE_FAILURE_MESSAGE
      );
      return;
    }

    if (request.type === "save") {
      // A recurring event asks for the scope over the editor, which stays
      // open: Cancel goes back to it with the edits.
      if (request.isRecurring) {
        // Where the user was (the title, Save), for a Cancel to return to.
        focusBeforeScopeRef.current = focusedElement();
        // The preferred scope is kept as is: the dialog shows the nearest
        // one available, and returns to it once it's on.
        dispatchDialog({
          pendingSave: {
            calendarChanged: request.calendarChanged,
            defaultScope: request.defaultScope,
            hasDataEdits: request.hasDataEdits,
            patternChanged: request.patternChanged,
            variables: request.variables,
          },
          type: "open-scope-dialog",
        });
        return;
      }

      holdForSave(saveEdits(request, "this"), SAVE_FAILURE_MESSAGE);
    }
  }, [createEvent, holdForSave, saveEdits, setOpen]);

  const dialogOver = scopeDialogOpen || simpleDeleteConfirmOpen;
  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    // Not behind a dialog over the editor (the scope or delete question):
    // there Cmd+Enter would re-ask and drop the choice made in it.
    { enabled: open && !readOnly && !dialogOver, enableOnFormTags: true },
    [dialogOver, handleSave, open, readOnly]
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
          align={narrowWindow ? "center" : align}
          className="max-h-(--radix-popover-content-available-height) w-[420px] max-w-[calc(100vw-1rem)] space-y-3 overflow-y-auto p-4"
          // Fits the space Radix measured and the window's width, scrolling
          // long notes rather than running off screen.
          collisionPadding={8}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleCancel();
          }}
          // Clicks in the scope dialog over the editor land outside it.
          onInteractOutside={(e) => {
            e.preventDefault();
            if (!scopeDialogOpen) {
              handleCancel();
            }
          }}
          // Editing, focus goes to the editor itself rather than its title
          // (selected, a keystroke would replace it): Tab starts inside,
          // and the calendar's shortcuts stay out of the dialog.
          onOpenAutoFocus={(e) => {
            if (mode === "edit") {
              e.preventDefault();
              if (e.currentTarget instanceof HTMLElement) {
                e.currentTarget.focus();
              }
            }
          }}
          ref={contentRef}
          // Beside its event there's no room for it on a narrow window, and
          // Radix only shifts a side placement up or down: below the event,
          // it shifts sideways to fit.
          side={narrowWindow ? "bottom" : side}
        >
          <EventEditForm
            accountId={accountId}
            calendarId={calendarId}
            closeSaveRequestRef={buildCloseSaveRequestRef}
            dialogOver={dialogOver}
            end={end}
            event={event}
            isSaving={isSaving}
            key={event?.id ?? "create-event"}
            mode={mode}
            onCancel={handleCancel}
            onDelete={handleDelete}
            onSave={handleSave}
            open={open}
            readOnly={readOnly}
            readOnlyReason={readOnlyReason}
            saveFailure={saveFailure}
            start={start}
          />
        </PopoverContent>
      </Popover>

      {/* Recurrence scope prompt over the editor (covers both save and move for recurring events). */}
      <RecurrenceScopeDialog
        // Says why each scope that's off is.
        description={saveDialog.description}
        disabledScopes={saveDialog.disabled}
        // The dialog has no trigger to return focus to, and a save remounts
        // the field it came from, so focus would fall to the page, where the
        // calendar's keys could navigate away from the editor. On Cancel it
        // goes back where the user was; during a save (or after it failed),
        // to the editor; once the editor has closed, it stays where that
        // put it (the event).
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const content = contentRef.current;
          // Already in the editor: a fast failure's message took it as the
          // dialog faded, and keeps it.
          if (!(open && content) || content.contains(document.activeElement)) {
            return;
          }
          const before = focusBeforeScopeRef.current;
          if (
            !savingRef.current &&
            before?.isConnected &&
            content.contains(before)
          ) {
            before.focus();
          } else {
            content.focus();
          }
        }}
        onConfirm={commitPendingSave}
        onOpenChange={(value) =>
          dispatchDialog({ type: "set-scope-dialog-open", value })
        }
        onValueChange={(value) =>
          dispatchDialog({ type: "set-selected-scope", value })
        }
        open={scopeDialogOpen}
        options={RECURRENCE_SCOPE_OPTIONS}
        subject={savedSubject(
          pendingSave,
          event,
          Boolean(pendingFacts.dateMoved),
          timeZone
        )}
        title={SCOPE_DIALOG_COPY.saveEvent.title}
        value={saveScope}
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
    payload: {
      accountId: values.selectedAccountId,
      calendarId: values.selectedCalendarId,
      event: {
        colorId: values.colorId ?? undefined,
        conferenceData: conferenceData ?? undefined,
        description: values.description?.trim() || undefined,
        end: temporalPayload.endPayload,
        location: values.location?.trim() || undefined,
        recurrence: values.recurrence?.length ? values.recurrence : undefined,
        start: temporalPayload.startPayload,
        summary: trimmedTitle,
      },
    },
    type: "create",
  };
}

/**
 * Whether the save changes the series' pattern, and the scope to suggest.
 * The repeat is sent only when the user changed it: an empty list then
 * means "Repeat: None", and leaving it out keeps the series' pattern. The
 * form's value alone can't say, since the master's pattern may load after
 * the editor opened.
 */
function editedPattern(
  values: EventFormValues,
  ctx: {
    event: GoogleEvent | undefined;
    masterRecurrence: string[] | null | undefined;
    recurrenceEdited: boolean;
  }
): { defaultScope: RecurrenceScope; patternChanged: boolean } {
  const sourceRecurrence = ctx.event?.recurrence?.length
    ? ctx.event.recurrence
    : (ctx.masterRecurrence ?? []);
  const patternChanged = repeatChanged({
    edited: ctx.recurrenceEdited,
    recurrence: values.recurrence,
    source: sourceRecurrence,
  });
  if (!ctx.event?.recurringEventId) {
    return { defaultScope: "all", patternChanged };
  }
  // A pattern change on an occurrence applies from it on, as for tasks.
  return {
    defaultScope: patternChanged ? "following" : "this",
    patternChanged,
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
    /** The user used the Repeat control. */
    recurrenceEdited: boolean;
    /** The zone the editor shows days in. */
    timeZone: string;
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
          ? (ctx.calendarTimeZone ?? ctx.timeZone)
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
  const { defaultScope, patternChanged } = editedPattern(values, ctx);

  const variables: UpdateGoogleEventInput = {
    accountId: ctx.accountId,
    calendarId: ctx.calendarId,
    event: {
      ...ctx.event,
      colorId: values.colorId ?? undefined,
      conferenceData: ctx.conferenceData ?? undefined,
      description: values.description ?? "",
      end: withEditedTime(ctx.event?.end, temporalPayload.endPayload),
      id: ctx.event?.id ?? "",
      location: values.location ?? "",
      recurrence: patternChanged ? values.recurrence : undefined,
      start: withEditedTime(ctx.event?.start, temporalPayload.startPayload),
      summary: values.summary.trim(),
    },
    eventId: ctx.event?.id ?? "",
  };

  return {
    calendarChanged: calendarChanged
      ? { destinationCalendarId: values.selectedCalendarId }
      : undefined,
    defaultScope,
    hasDataEdits: ctx.hasEdits,
    isRecurring,
    patternChanged,
    type: "save",
    variables,
  };
}

function MeetingSection({
  meetingLink,
  isConferencePending,
  onCreateMeeting,
}: {
  meetingLink: MeetingLink | null;
  isConferencePending: boolean;
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
  summary,
  onSelectColor,
  onSummaryChange,
}: {
  colorEntries: [string, { background?: string; foreground?: string }][];
  selectedColorId: string | undefined;
  calendarFallbackColor: string | undefined;
  isCreateMode: boolean;
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
              selectedColorId ? "border-transparent" : "border-muted"
            )}
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
        value={summary}
      />
    </div>
  );
}

const REPEATS_PREFIX = /^Repeats /;
const FIRST_LETTER = /^./;
const WEEKLY_ON = /^Weekly on /;

/** "Repeats weekly on Mon" as the Repeat button says it: "Weekly on Mon". */
function repeatRuleLabel(
  recurrenceRule: string | undefined,
  seriesStart: Temporal.PlainDate | null
): string | null {
  const repeats = recurrenceRule
    ? describeEventRecurrence({
        rules: [recurrenceRule],
        start: seriesStart ?? undefined,
      })
    : null;
  return repeats
    ? repeats
        .replace(REPEATS_PREFIX, "")
        .replace(FIRST_LETTER, (c) => c.toUpperCase())
    : null;
}

function RepeatChipText({ rule }: { rule: string }) {
  return (
    <span className="min-w-0 truncate">
      {rule
        .replace(WEEKLY_ON, "")
        .replace(FIRST_LETTER, (c) => c.toUpperCase())}
    </span>
  );
}

/**
 * In place of the repeat chip when the series' rule didn't load: its repeat
 * can't be edited from a copy that may be old, so say so and offer to load
 * it again.
 */
function RepeatRetryButton({
  besideRule,
  onRetry,
}: {
  /** A known (older) rule is shown beside it, so the icon is already there. */
  besideRule: boolean;
  onRetry?: () => void;
}) {
  const reason = besideRule
    ? "The series' repeat didn't refresh. Retry"
    : "The series' repeat didn't load. Retry";
  return (
    <Button
      aria-label={reason}
      // Gives way first, like the repeat chip: the calendar beside it stays.
      className="h-8 min-w-0 shrink gap-1.5 px-2 text-xs"
      onClick={onRetry}
      size="sm"
      title={reason}
      variant="outline"
    >
      {besideRule ? null : <Repeat className="size-4 shrink-0" />}
      <span className="truncate">Retry repeat</span>
    </Button>
  );
}

/** The repeat chip, which opens the repeat editor. */
function RepeatControl({
  allDay,
  disabled,
  loading,
  onRecurrenceChange,
  recurrenceRule,
  ruleLabel,
  seriesStart,
  seriesTimeZone,
  endFrom,
}: {
  allDay: boolean;
  disabled: boolean;
  /** The event's own day, for an end date's default and minimum. */
  endFrom: Temporal.PlainDate | null;
  /**
   * The occurrence's series rule hasn't loaded yet: it repeats, but how
   * isn't known, so it mustn't read as "doesn't repeat".
   */
  loading: boolean;
  onRecurrenceChange: (rule: string | null) => void;
  recurrenceRule: string | undefined;
  ruleLabel: string | null | undefined;
  seriesStart: Temporal.PlainDate | null;
  seriesTimeZone: string;
}) {
  const waiting = loading && !ruleLabel;
  const ruleText = waiting ? "Loading repeat…" : ruleLabel;
  const repeatLabel = ruleText;
  // While the series' rule isn't usable (it's being fetched again), an
  // open editor closes and its changes are dropped: one then would keep
  // the old rule.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);
  return (
    <Popover onOpenChange={setOpen} open={open && !disabled}>
      <PopoverTrigger asChild>
        {/* Says how the event repeats, so the editor shows it's a series. */}
        <Button
          aria-label={
            waiting ? "Loading repeat…" : `Repeat: ${repeatLabel ?? "None"}`
          }
          className={cn(
            // The rule gives way first: the calendar beside it stays readable.
            repeatLabel ? "h-8 min-w-0 shrink gap-1.5 px-2 text-xs" : "size-8"
          )}
          disabled={disabled}
          size={repeatLabel ? "sm" : "icon"}
          title={repeatLabel ?? "Repeat"}
          variant={repeatLabel ? "secondary" : "outline"}
        >
          <Repeat className="size-4 shrink-0" />
          {ruleLabel ? <RepeatChipText rule={ruleLabel} /> : null}
          {waiting ? <span className="truncate">{ruleText}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-1rem)]"
        collisionPadding={8}
      >
        <RecurrenceEditor
          allDay={allDay}
          endFrom={
            endFrom ?? seriesStart ?? Temporal.Now.plainDateISO(seriesTimeZone)
          }
          onChange={(rule) => {
            if (!disabled) {
              onRecurrenceChange(rule);
            }
          }}
          recurrenceRule={recurrenceRule}
          start={seriesStart ?? Temporal.Now.plainDateISO(seriesTimeZone)}
          timeZone={seriesTimeZone}
        />
      </PopoverContent>
    </Popover>
  );
}

/** What the repeat row's live region says: why it waits, or that it failed. */
function repeatAnnouncement(
  waitReason: string | undefined,
  failed: boolean,
  ruleKnown: boolean
): string {
  if (waitReason) {
    return waitReason;
  }
  if (!failed) {
    return "";
  }
  return ruleKnown
    ? "The series' repeat didn't refresh"
    : "The series' repeat didn't load";
}

function EventAllDayAndRecurrenceRow({
  allDay,
  onToggleAllDay,
  recurrenceLoading,
  recurrenceFailed = false,
  recurrenceWaitReason,
  onRetryRecurrence,
  recurrenceRule,
  seriesStart,
  seriesTimeZone,
  endFrom,
  onRecurrenceChange,
  calendarOptions,
  calendarValue,
  onCalendarChange,
}: {
  allDay: boolean;
  onToggleAllDay: () => void;
  /** The occurrence's pattern isn't usable yet (loading, or it failed). */
  recurrenceLoading: boolean;
  /** Loading the occurrence's pattern failed: offer to try again. */
  recurrenceFailed?: boolean;
  /** Why the repeat waits (offline), for its tooltip. */
  recurrenceWaitReason?: string;
  onRetryRecurrence?: () => void;
  recurrenceRule: string | undefined;
  /**
   * The series' start day in its own zone, for the rule's words and the
   * editor's defaults.
   */
  seriesStart: Temporal.PlainDate | null;
  /** The series' zone (the app's for a new one), where its days count. */
  seriesTimeZone: string;
  /** The event's own day in the series' zone, for an end date's minimum. */
  endFrom: Temporal.PlainDate | null;
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
  const ruleLabel = repeatRuleLabel(recurrenceRule, seriesStart);
  const waitShown = Boolean(recurrenceWaitReason) && !ruleLabel;
  const retryShown = !recurrenceWaitReason && recurrenceFailed;
  // What the live region says: why the repeat waits, or that it didn't
  // load. Filled after mount: a live region that mounts already filled
  // often isn't announced (an editor opened offline).
  const announcement = repeatAnnouncement(
    recurrenceWaitReason,
    retryShown,
    Boolean(ruleLabel)
  );
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    setAnnounced(announcement);
  }, [announcement]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        aria-pressed={allDay}
        className="gap-2 text-xs"
        onClick={onToggleAllDay}
        size="sm"
        type="button"
        variant="outline"
      >
        <div
          aria-hidden
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
      {/* A known rule stays, dimmed, while it can't be used; with none
          known, the wait or the retry stands in for the chip. */}
      {waitShown || (retryShown && !ruleLabel) ? null : (
        <RepeatControl
          allDay={allDay}
          disabled={recurrenceLoading}
          endFrom={endFrom}
          loading={recurrenceLoading}
          onRecurrenceChange={onRecurrenceChange}
          recurrenceRule={recurrenceRule}
          ruleLabel={ruleLabel}
          seriesStart={seriesStart}
          seriesTimeZone={seriesTimeZone}
        />
      )}
      {/* Offline: why the repeat waits ("Offline", the full reason for
          screen readers), in a live region that stays mounted and fills
          after it mounts, so it's announced. A retry would only wait too.
          A failed load is announced there as well. */}
      <span
        className={
          recurrenceWaitReason
            ? "flex h-8 min-w-0 shrink-0 items-center gap-1.5 text-muted-foreground text-xs"
            : "sr-only"
        }
        role="status"
      >
        {recurrenceWaitReason ? (
          <>
            {waitShown ? (
              <Repeat aria-hidden className="size-4 shrink-0" />
            ) : null}
            <span aria-hidden>Offline</span>
          </>
        ) : null}
        <span className="sr-only">{announced}</span>
      </span>
      {retryShown ? (
        <RepeatRetryButton
          besideRule={Boolean(ruleLabel)}
          onRetry={onRetryRecurrence}
        />
      ) : null}
      <Select onValueChange={onCalendarChange} value={calendarValue}>
        <SelectTrigger className="ml-auto h-8 w-auto min-w-28 max-w-44 shrink-0 gap-1.5 px-2 text-xs">
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
    recurrence: watched.recurrence ?? [],
    selectedAccountId: watched.selectedAccountId ?? "",
    selectedCalendarId: watched.selectedCalendarId ?? "",
    startDate: watched.startDate,
    startTime: watched.startTime ?? "",
    summary: watched.summary ?? "",
  };
}

/**
 * What a recurring save moves, as the scope dialog's line ("Retro → Mon,
 * Nov 9 · 4:00 – 4:45 PM"), when it changes the occurrence's times; the
 * same line a drop on the grid shows.
 */
function savedSubject(
  pendingSave: PendingSave | null,
  event: GoogleEvent | undefined,
  /** It moved to another day (rather than took a new time on its own). */
  moved: boolean,
  timeZone: string
): ScopeDialogSubject | undefined {
  const edited = pendingSave?.variables.event;
  if (!(edited && event)) {
    return;
  }
  const at = (time: GoogleEvent["start"] | undefined) =>
    time?.dateTime ? Date.parse(time.dateTime) : time?.date;
  if (
    at(edited.start) === at(event.start) &&
    at(edited.end) === at(event.end)
  ) {
    return;
  }
  const start = new Date(
    edited.start?.dateTime ?? `${edited.start?.date}T00:00`
  );
  const end = new Date(edited.end?.dateTime ?? `${edited.end?.date}T00:00`);
  return {
    moved,
    name: edited.summary || "(No title)",
    when: describeEventWhen(edited, start, end, timeZone),
  };
}

/** When a read-only event happens, in words: "Thu, Nov 12 · All day". */
function describeEventWhen(
  event: GoogleEvent | undefined,
  start: Date,
  end: Date,
  timeZone: string
): string {
  if (event?.start?.date) {
    const first = Temporal.PlainDate.from(event.start.date);
    // Google's all-day end date is exclusive.
    const last = event.end?.date
      ? Temporal.PlainDate.from(event.end.date).subtract({ days: 1 })
      : first;
    return formatAllDayWhen(first, last);
  }
  const toZoned = (date: Date) =>
    Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(
      timeZone
    );
  return formatEventWhen(toZoned(start), toZoned(end));
}

/**
 * A locked, Gmail, or birthday event, shown as information rather than a
 * disabled form: why it can't be edited, then what people open it for (the
 * time, joining the call, the place on a map, the notes to copy).
 */
function ReadOnlyEventDetails({
  calendarColor,
  calendarLabel,
  description,
  end,
  event,
  location,
  mapsUrl,
  meetingLink,
  onClose,
  reason,
  recurrence,
  repeatDay,
  seriesTimeZone,
  start,
  summary,
}: {
  calendarColor: string | undefined;
  calendarLabel: string | undefined;
  description: string | undefined;
  end: Date;
  event: GoogleEvent | undefined;
  location: string | undefined;
  mapsUrl: string | null;
  meetingLink: MeetingLink | null;
  onClose?: () => void;
  reason: string | null | undefined;
  /** The series' RRULEs (the event's own, or its master's). */
  recurrence: string[];
  /** The displayed start day, used for implicit repeat days. */
  repeatDay: Temporal.PlainDate | null;
  /** The series' zone, where its end day is counted. */
  seriesTimeZone: string;
  start: Date;
  summary: string | undefined;
}) {
  const timeZone = useAtomValue(timezoneAtom);
  const repeats = describeEventRecurrence({
    eventType: event?.eventType,
    recurringEventId: event?.recurringEventId,
    rules: recurrence,
    start: repeatDay ?? pickerDateToTemporal(start),
    timeZone: seriesTimeZone,
  });
  // Google keeps birthdays on the primary calendar; name what they are.
  const calendarName =
    event?.eventType === "birthday" ? "Birthdays" : calendarLabel;
  const place = location?.trim();
  const notes = description?.trim();
  return (
    <div className="space-y-3 text-sm">
      {reason ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">{reason}</p>
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium text-base">{summary || "(No title)"}</p>
        <p className="text-muted-foreground">
          {describeEventWhen(event, start, end, timeZone)}
        </p>
        {repeats ? <p className="text-muted-foreground">{repeats}</p> : null}
        {calendarName ? (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: calendarColor ?? "currentColor" }}
            />
            {calendarName}
          </p>
        ) : null}
      </div>
      {meetingLink ? (
        <Button asChild size="sm" type="button" variant="outline">
          <a href={meetingLink.url} rel="noreferrer" target="_blank">
            <Video className="size-3" />
            Join {meetingLink.label}
          </a>
        </Button>
      ) : null}
      {place ? (
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          {mapsUrl ? (
            <a
              className="underline underline-offset-2"
              href={mapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              {place}
            </a>
          ) : (
            place
          )}
        </p>
      ) : null}
      {notes ? <p className="whitespace-pre-wrap">{notes}</p> : null}
      {/* Close stays in view while long notes scroll (the popover's p-4
          is offset so nothing shows beneath it). */}
      {onClose ? (
        <div className="sticky -bottom-4 -mx-4 -mb-4 flex justify-end bg-popover px-4 pt-2 pb-4">
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Moves the form's start, keeping the event's length (shared with iOS): a
 * 2–4 PM meeting moved to 3 PM ends at 5 PM, onto the next day past
 * midnight.
 */
function applyMovedStart(
  values: EventFormValues,
  setValue: UseFormSetValue<EventFormValues>,
  next: { date?: Temporal.PlainDate; time?: Temporal.PlainTime }
) {
  if (!values.startDate) {
    return;
  }
  const moved = moveEventStart(formRange(values, values.startDate), next);
  const dirty = { shouldDirty: true };
  setValue("startDate", temporalToPickerDate(moved.startDate), dirty);
  setValue("endDate", temporalToPickerDate(moved.endDate), dirty);
  if (moved.startTime) {
    setValue("startTime", timeInputValue(moved.startTime), dirty);
  }
  if (moved.endTime) {
    setValue("endTime", timeInputValue(moved.endTime), dirty);
  }
}

/** A time input's value ("09:05"). */
function timeInputValue(time: Temporal.PlainTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

/** The form's range as Temporal values, for moveEventStart. */
function formRange(values: EventFormValues, startDate: Date) {
  const time = (value: string) =>
    !values.allDay && value ? Temporal.PlainTime.from(value) : null;
  const start = pickerDateToTemporal(startDate);
  return {
    endDate: values.endDate ? pickerDateToTemporal(values.endDate) : start,
    endTime: time(values.endTime),
    startDate: start,
    startTime: time(values.startTime),
  };
}

/** Whether the form ends before it starts (Save stays off, with a reason). */
function endsBeforeStart(values: Partial<EventFormValues>): boolean {
  if (!(values.startDate && values.endDate)) {
    return false;
  }
  const range = formRange(values as EventFormValues, values.startDate);
  if (!(range.startTime && range.endTime)) {
    return Temporal.PlainDate.compare(range.endDate, range.startDate) < 0;
  }
  return (
    Temporal.PlainDateTime.compare(
      range.endDate.toPlainDateTime(range.endTime),
      range.startDate.toPlainDateTime(range.startTime)
    ) < 0
  );
}

function EndsBeforeStartNote({ values }: { values: Partial<EventFormValues> }) {
  return endsBeforeStart(values) ? (
    <p className="text-destructive text-xs">Ends before it starts.</p>
  ) : null;
}

function EventFormActionRow({
  isCreateMode,
  saveDisabled = false,
  saving = false,
  onDelete,
  onCancel,
  onSave,
}: {
  isCreateMode: boolean;
  saveDisabled?: boolean;
  /** Saving: the row waits, and Save says so. */
  saving?: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <Separator />
      <div className="flex items-center gap-2">
        {isCreateMode ? null : (
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
            Cancel
          </Button>
          <Button
            disabled={saveDisabled}
            onClick={onSave}
            size="sm"
            type="button"
          >
            <SavingLabel saving={saving}>Save</SavingLabel>
          </Button>
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
  closeSaveRequestRef,
  isSaving = false,
  saveFailure = null,
  onSave,
  onCancel,
  onDelete,
  open,
  dialogOver = false,
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
  /** A save is running: the fields are read-only and Save says "Saving…". */
  isSaving?: boolean;
  /** Why the last save failed, shown beside Save. */
  saveFailure?: string | null;
  /** Trigger the save flow (builds close-save request and processes it). */
  onSave: () => void;
  /** Close without saving. When provided, the form shows its own Save/Cancel buttons. */
  onCancel?: () => void;
  onDelete: () => void;
  open: boolean;
  /** A dialog is open over the editor, which then takes no shortcuts. */
  dialogOver?: boolean;
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
    // Not behind a dialog over the editor (the scope or delete question).
    { enabled: open && !isCreateMode && !readOnly && !dialogOver },
    [dialogOver, onDelete, open, isCreateMode, readOnly]
  );
  // Closing the popover alone discards edits; the wrapper owns saves and dialogs.
  const hasUserEditedRef = useRef(false);
  /** The user used the Repeat control; only then is the repeat saved. */
  const recurrenceEditedRef = useRef(false);
  // Days in the zone the app shows (and saves) times in.
  const timeZone = useAtomValue(timezoneAtom);

  const masterQuery = useRecurringEventMaster({
    accountId,
    calendarId,
    enabled: open,
    event: event ?? (null as GoogleEvent | null),
  });
  // Use the event zone for displaying the repeat end date.
  const seriesTimeZone = event?.start.timeZone ?? timeZone;

  const isAllDay = Boolean(event?.start?.date);
  // All-day dates go to the pickers as local dates. (new Date("2026-11-12")
  // is UTC midnight, which is the day before west of UTC, and saving would
  // then move the event a day earlier.)
  const initialStartDate = useMemo(() => {
    if (isAllDay && event?.start?.date) {
      return temporalToPickerDate(Temporal.PlainDate.from(event.start.date));
    }
    return start;
  }, [event?.start?.date, isAllDay, start]);

  const initialEndDate = useMemo(() => {
    if (isAllDay && event?.end?.date) {
      // Google all-day events use exclusive end date, subtract 1 day for display
      return temporalToPickerDate(
        Temporal.PlainDate.from(event.end.date).subtract({ days: 1 })
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
      allDay: isAllDay,
      colorId: event?.colorId ?? undefined,
      description: event?.description ?? "",
      endDate: initialEndDate ?? null,
      endTime: isAllDay ? "" : formatTimeString(initialEndDate),
      location: event?.location ?? "",
      recurrence: recurrenceSource,
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
      recurrenceSource,
      initialEndDate,
      initialStartDate,
      isAllDay,
    ]
  );

  const { control, setValue, getValues } = useForm<EventFormValues>({
    defaultValues: initialValues,
  });
  // A move or resize while the editor is open updates its times, keeping
  // any other unsaved edits, so Save can't write the old times back.
  const scheduleKey = `${initialStartDate?.getTime()}|${initialEndDate?.getTime()}`;
  const lastScheduleKeyRef = useRef(scheduleKey);
  useEffect(() => {
    if (scheduleKey === lastScheduleKeyRef.current) {
      return;
    }
    lastScheduleKeyRef.current = scheduleKey;
    setValue("startDate", initialValues.startDate);
    setValue("startTime", initialValues.startTime);
    setValue("endDate", initialValues.endDate);
    setValue("endTime", initialValues.endTime);
  }, [initialValues, scheduleKey, setValue]);
  // An occurrence's pattern lives on its master, which may load after the
  // editor opened: show it then, unless the user has already changed it.
  useEffect(() => {
    if (!recurrenceEditedRef.current) {
      setValue("recurrence", recurrenceSource);
    }
  }, [recurrenceSource, setValue]);
  const [pendingConference, setPendingConference] = useState<
    GoogleEvent["conferenceData"] | null
  >(null);
  const pendingConferenceRef = useRef<GoogleEvent["conferenceData"] | null>(
    null
  );
  const [locationOpen, setLocationOpen] = useState(false);

  const rawWatched = useWatch({ control });
  const watchedValues = resolveWatchedDefaults(rawWatched);
  const locationQuery = watchedValues.location.trim();
  const locationSearch = useLocationSearch(locationQuery);
  const locationSuggestions = locationSearch.data ?? [];
  const isLocationSearching = locationSearch.isFetching;

  const meetingSource = useMemo(
    () => ({
      ...(event ?? {}),
      // Use pendingConference state (not ref) to ensure memo recomputes on changes
      conferenceData: pendingConference ?? event?.conferenceData,
      description: watchedValues.description,
      location: watchedValues.location,
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
  // Closed while a save runs: its suggestions render outside the fieldset.
  const locationPopoverOpen =
    locationOpen && !isSaving && locationQuery.length >= 2;

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
          canWriteCalendar(c.calendar.accessRole) &&
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

  const moveStart = (next: {
    date?: Temporal.PlainDate;
    time?: Temporal.PlainTime;
  }) => {
    hasUserEditedRef.current = true;
    const before = getValues();
    applyMovedStart(before, setValue, next);
  };

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

    if (field === "startTime" && getValues("startDate")) {
      moveStart({ time: new Temporal.PlainTime(hours, minutes) });
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
      onSave();
    }
  }, [canCreateMeeting, isCreateMode, onSave]);

  const buildCloseSaveRequest = useCallback(
    (values: EventFormValues): CloseSaveRequest => {
      // Every save path (Save, Cmd+Enter, Add Meet, the create popover)
      // comes through here, so none can write an end before the start.
      if (endsBeforeStart(values)) {
        return { type: "invalid" };
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
        recurrenceEdited: recurrenceEditedRef.current,
        timeZone,
      });
    },
    [
      timeZone,
      accountId,
      calendarId,
      clampToStartIfNeeded,
      event,
      isCreateMode,
      calendar?.calendar.timeZone,
      masterQuery.data,
      pendingConference,
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

  useImperativeHandle(
    createInteropRef,
    () => ({ applySharedFields, getSharedFields }),
    [applySharedFields, getSharedFields]
  );

  const formStartDay = watchedValues.startDate
    ? pickerDateToTemporal(watchedValues.startDate)
    : null;
  const startTimeValue = watchedValues.allDay ? "" : watchedValues.startTime;
  const endTimeValue = watchedValues.allDay ? "" : watchedValues.endTime;
  const recurrenceRule = getPrimaryRecurrenceRule(watchedValues.recurrence);
  // Any editable event can repeat, a one-off one included. While an
  // occurrence's pattern loads, the control waits: a change made before it
  // arrives would be compared against nothing.
  const recurrenceLoading = masterQuery.ruleUnavailable;

  if (readOnly) {
    const source = calendars.find(
      (c) => c.accountId === accountId && c.calendar.id === calendarId
    );
    return (
      <ReadOnlyEventDetails
        calendarColor={source?.calendar.backgroundColor ?? undefined}
        calendarLabel={source?.calendar.summary}
        description={watchedValues.description}
        end={end}
        event={event}
        location={watchedValues.location}
        mapsUrl={mapsUrl}
        meetingLink={meetingLink}
        onClose={onCancel}
        reason={readOnlyReason}
        recurrence={recurrenceSource}
        repeatDay={formStartDay}
        seriesTimeZone={seriesTimeZone}
        start={start}
        summary={watchedValues.summary}
      />
    );
  }

  return (
    <HeldFieldset className="min-w-0 space-y-3" saving={isSaving}>
      {headerContent ? <div>{headerContent}</div> : null}
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
        selectedColorId={watchedValues.colorId}
        summary={watchedValues.summary}
      />
      <Textarea
        onChange={(e) => {
          hasUserEditedRef.current = true;
          setValue("description", e.target.value, { shouldDirty: true });
        }}
        placeholder="Add details..."
        value={watchedValues.description}
      />
      <Separator />
      <EventAllDayAndRecurrenceRow
        allDay={watchedValues.allDay}
        calendarOptions={calendarPickerOptions}
        calendarValue={`${effectiveAccountId}::${effectiveCalendarId}`}
        endFrom={formStartDay}
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
          recurrenceEditedRef.current = true;
          // Keep recurrence lines the repeat editor does not edit.
          setValue(
            "recurrence",
            setPrimaryRecurrenceRule(getValues("recurrence"), rule),
            { shouldDirty: true }
          );
        }}
        onRetryRecurrence={masterQuery.retry}
        onToggleAllDay={() => {
          hasUserEditedRef.current = true;
          setValue("allDay", !watchedValues.allDay, { shouldDirty: true });
        }}
        recurrenceFailed={masterQuery.ruleFailed}
        recurrenceLoading={recurrenceLoading}
        recurrenceRule={recurrenceRule}
        recurrenceWaitReason={
          masterQuery.rulePaused ? "Repeat loads when you're online" : undefined
        }
        seriesStart={formStartDay}
        seriesTimeZone={seriesTimeZone}
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
                  // Opens on the event's month, not today's.
                  defaultMonth={field.value ?? undefined}
                  mode="single"
                  onSelect={(date) => {
                    if (date && getValues("startDate")) {
                      moveStart({ date: pickerDateToTemporal(date) });
                      return;
                    }
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
                  // Opens on the event's month, not today's.
                  defaultMonth={field.value ?? undefined}
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
            onChange={(v) => handleTimeChange("startTime", v)}
            placeholder="Start time"
            value={startTimeValue}
          />
          <TimePicker
            onChange={(v) => handleTimeChange("endTime", v)}
            placeholder="End time"
            value={endTimeValue}
          />
        </div>
      )}
      <EndsBeforeStartNote values={watchedValues} />
      <MeetingSection
        isConferencePending={isConferencePending}
        meetingLink={meetingLink}
        onCreateMeeting={handleCreateMeeting}
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
        suggestions={locationSuggestions}
      />
      <SaveFailure message={saveFailure} />
      {onCancel ? (
        <EventFormActionRow
          isCreateMode={isCreateMode}
          onCancel={onCancel}
          onDelete={onDelete}
          onSave={onSave}
          saveDisabled={endsBeforeStart(watchedValues)}
          saving={isSaving}
        />
      ) : null}
    </HeldFieldset>
  );
}
