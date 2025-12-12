"use client";

import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { addDays, format } from "date-fns";
import { useAtomValue } from "jotai";
import { CalendarIcon, Clock3, Palette, Repeat, Timer } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { normalizedGoogleColorsAtomFamily } from "@/atoms/google-colors";
import { googleCalendarsDataAtom } from "@/atoms/google-data";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMoveGoogleEventMutation } from "@/hooks/use-move-google-event-mutation";
import { useRecurringEventMaster } from "@/hooks/use-recurring-event-master";
import {
  type UpdateGoogleEventInput,
  useUpdateGoogleEventMutation,
} from "@/hooks/use-update-google-event-mutation";
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

type EventEditPopoverProps = {
  event: GoogleEvent;
  accountId: string;
  calendarId: string;
  start: Date;
  end: Date;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
};

type EventFormValues = {
  summary: string;
  description: string;
  location: string;
  colorId?: string;
  allDay: boolean;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string;
  endTime: string;
  recurrence: string[];
};

type CalendarOption = {
  accountId: string;
  calendarId: string;
  label: string;
};

type RecurrenceScopeOption = {
  value: RecurrenceScope;
  label: string;
};

const RECURRENCE_SCOPE_OPTIONS: RecurrenceScopeOption[] = [
  { value: "this", label: "Only this occurrence" },
  { value: "all", label: "Entire series" },
  { value: "following", label: "This and following" },
];

function RecurrenceScopeDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  onValueChange,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  onCancel,
  onConfirm,
  disabledScopes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  value: RecurrenceScope;
  onValueChange: (value: RecurrenceScope) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onConfirm: () => void | Promise<void>;
  disabledScopes?: Partial<Record<RecurrenceScope, boolean>>;
}) {
  const idBase = useId();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <RadioGroup
          onValueChange={(next) => onValueChange(next as RecurrenceScope)}
          value={value}
        >
          {RECURRENCE_SCOPE_OPTIONS.map((opt) => {
            const id = `${idBase}-${opt.value}`;
            const isDisabled = Boolean(disabledScopes?.[opt.value]);
            return (
              <Label
                className={cn(
                  "flex items-center gap-3 rounded-md border p-3",
                  value === opt.value ? "bg-muted" : "",
                  isDisabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer"
                )}
                htmlFor={id}
                key={opt.value}
              >
                <RadioGroupItem
                  disabled={isDisabled}
                  id={id}
                  value={opt.value}
                />
                <span className="text-sm">{opt.label}</span>
              </Label>
            );
          })}
        </RadioGroup>

        <DialogFooter>
          <Button
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
            type="button"
            variant="ghost"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            type="button"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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

  type RecurrenceEditorValues = {
    freq: Frequency;
    byDay: string[];
    endType: RecurrenceEnd["type"];
    /** Stored as RRULE UNTIL value (e.g. `YYYYMMDDT...Z`). Empty means unset. */
    untilRule: string;
    count: number;
  };

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
}: EventEditPopoverProps) {
  const [open, setOpen] = useState(false);
  const updateEvent = useUpdateGoogleEventMutation();
  const moveEvent = useMoveGoogleEventMutation();
  const calendars = useAtomValue(googleCalendarsDataAtom);

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
  } | null>(null);
  const [selectedScope, setSelectedScope] = useState<RecurrenceScope>("this");

  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveScope, setMoveScope] = useState<RecurrenceScope>("this");
  const [moveScopeDialogOpen, setMoveScopeDialogOpen] = useState(false);
  const [moveDestinationCalendarId, setMoveDestinationCalendarId] = useState<
    string | null
  >(null);
  const postSaveIntentRef = useRef<"move" | null>(null);

  const calendarOptions = useMemo<CalendarOption[]>(
    () =>
      calendars
        // Moving across Google accounts is not supported by this flow.
        .filter((c) => c.accountId === accountId)
        .map((c) => ({
          accountId: c.accountId,
          calendarId: c.calendar.id,
          label: c.calendar.summary ?? "Calendar",
        })),
    [accountId, calendars]
  );

  const openMoveDialog = useCallback(() => {
    const isRecurring = Boolean(
      event.recurringEventId || event.recurrence?.length
    );
    let defaultScope: RecurrenceScope = "this";
    if (isRecurring && !event.recurringEventId) {
      defaultScope = "all";
    }
    setMoveScope(defaultScope);

    // Default destination = first calendar that is not the current one (if any).
    const firstOther =
      calendarOptions.find((c) => c.calendarId !== calendarId)?.calendarId ??
      null;
    setMoveDestinationCalendarId(firstOther);
    setMoveDialogOpen(true);
  }, [calendarId, calendarOptions, event.recurringEventId, event.recurrence]);

  const commitPendingSave = useCallback(async () => {
    if (!pendingSave) {
      return;
    }
    const { variables } = pendingSave;
    await updateEvent.mutateAsync({
      ...variables,
      recurrenceScope: selectedScope,
    });
    setPendingSave(null);
  }, [pendingSave, selectedScope, updateEvent]);

  const handleClose = useCallback(
    (intent?: "move") => {
      const request = buildCloseSaveRequestRef.current?.() ?? { type: "none" };
      setOpen(false);

      if (request.type === "none") {
        if (intent === "move") {
          openMoveDialog();
        }
        return;
      }

      if (request.type === "save") {
        if (request.isRecurring) {
          setPendingSave({
            variables: request.variables,
            defaultScope: request.defaultScope,
          });
          setSelectedScope(request.defaultScope);
          postSaveIntentRef.current = intent ?? null;
          setScopeDialogOpen(true);
          return;
        }

        if (intent === "move") {
          // Ensure edits are saved before moving.
          updateEvent
            .mutateAsync({
              ...request.variables,
              recurrenceScope: "this",
            })
            .then(() => {
              openMoveDialog();
            })
            .catch(() => null);
          return;
        }

        updateEvent.mutate({
          ...request.variables,
          recurrenceScope: "this",
        });
      }
    },
    [openMoveDialog, updateEvent]
  );

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
            onRegisterCloseSaveRequest={(fn) => {
              buildCloseSaveRequestRef.current = fn;
            }}
            onRequestMove={() => handleClose("move")}
            start={start}
          />
        </PopoverContent>
      </Popover>

      {/* Post-close recurrence scope prompt. Only shown when the user actually edited. */}
      <RecurrenceScopeDialog
        description="Choose how broadly to apply your changes."
        onCancel={() => {
          // Cancelling the scope dialog discards the edits (no save).
          setPendingSave(null);
          postSaveIntentRef.current = null;
        }}
        onConfirm={async () => {
          await commitPendingSave();
          if (postSaveIntentRef.current === "move") {
            postSaveIntentRef.current = null;
            openMoveDialog();
          }
        }}
        onOpenChange={setScopeDialogOpen}
        onValueChange={setSelectedScope}
        open={scopeDialogOpen}
        title="Save recurring event changes"
        value={selectedScope}
      />

      {/* Separate “Move to calendar…” flow. */}
      <Dialog onOpenChange={setMoveDialogOpen} open={moveDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Move event</DialogTitle>
            <DialogDescription>
              Choose a destination calendar and how broadly to apply the move.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Destination calendar</Label>
              <div className="grid gap-2">
                {calendarOptions
                  .filter((c) => c.calendarId !== calendarId)
                  .map((c) => {
                    const selected = moveDestinationCalendarId === c.calendarId;
                    return (
                      <Button
                        className={cn(
                          "justify-start",
                          selected ? "bg-muted" : ""
                        )}
                        key={c.calendarId}
                        onClick={() =>
                          setMoveDestinationCalendarId(c.calendarId)
                        }
                        type="button"
                        variant={selected ? "secondary" : "outline"}
                      >
                        {c.label}
                      </Button>
                    );
                  })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Scope</Label>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="text-sm">
                  {RECURRENCE_SCOPE_OPTIONS.find((o) => o.value === moveScope)
                    ?.label ?? "Scope"}
                </div>
                <Button
                  onClick={() => setMoveScopeDialogOpen(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Change…
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setMoveDialogOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={!moveDestinationCalendarId || moveEvent.isPending}
              onClick={async () => {
                if (!moveDestinationCalendarId) {
                  return;
                }
                await moveEvent.mutateAsync({
                  accountId,
                  calendarId,
                  eventId: event.id,
                  destinationCalendarId: moveDestinationCalendarId,
                  scope: moveScope,
                });
                setMoveDialogOpen(false);
              }}
              type="button"
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecurrenceScopeDialog
        confirmLabel="Done"
        description="Choose how broadly to apply the move."
        disabledScopes={
          event.recurringEventId || event.recurrence?.length
            ? undefined
            : { all: true, following: true }
        }
        onConfirm={() => {
          return;
        }}
        onOpenChange={setMoveScopeDialogOpen}
        onValueChange={setMoveScope}
        open={moveScopeDialogOpen}
        title="Move scope"
        value={moveScope}
      />
    </>
  );
}

function EventEditForm({
  event,
  accountId,
  calendarId,
  start,
  end,
  onRegisterCloseSaveRequest,
  onRequestMove,
}: {
  event: GoogleEvent;
  accountId: string;
  calendarId: string;
  start: Date;
  end: Date;
  onRegisterCloseSaveRequest: (fn: () => CloseSaveRequest) => void;
  onRequestMove: () => void;
}) {
  /**
   * We intentionally do not run mutations from inside the form.
   * The popover wrapper controls “save on close” and dialogs.
   */
  const hasUserEditedRef = useRef(false);
  const masterQuery = useRecurringEventMaster({ accountId, calendarId, event });

  const isAllDay = Boolean(event.start?.date);
  const initialStartDate = useMemo(() => {
    if (isAllDay && event.start?.date) {
      return new Date(event.start.date);
    }
    return start;
  }, [event.start?.date, isAllDay, start]);

  const initialEndDate = useMemo(() => {
    if (isAllDay && event.end?.date) {
      return addDays(new Date(event.end.date), -1);
    }
    return end;
  }, [end, event.end?.date, isAllDay]);

  const recurrenceSource = useMemo(
    () =>
      event.recurrence?.length
        ? event.recurrence
        : (masterQuery.data?.recurrence ?? []),
    [event.recurrence, masterQuery.data?.recurrence]
  );

  const initialValues = useMemo<EventFormValues>(
    () => ({
      summary: event.summary ?? "",
      description: event.description ?? "",
      location: event.location ?? "",
      colorId: event.colorId ?? undefined,
      allDay: isAllDay,
      startDate: initialStartDate ?? null,
      endDate: initialEndDate ?? null,
      startTime: isAllDay
        ? ""
        : format(initialStartDate ?? new Date(), "HH:mm"),
      endTime: isAllDay ? "" : format(initialEndDate ?? new Date(), "HH:mm"),
      recurrence: recurrenceSource,
    }),
    [
      event.colorId,
      event.description,
      event.location,
      event.summary,
      recurrenceSource,
      initialEndDate,
      initialStartDate,
      isAllDay,
    ]
  );

  const { control, reset, setValue, getValues } = useForm<EventFormValues>({
    defaultValues: initialValues,
  });

  // Keep form synced if event changes underneath.
  useEffect(() => {
    // Reset “edited” tracking when the underlying event changes.
    hasUserEditedRef.current = false;
    reset(initialValues, { keepDirty: false });
  }, [initialValues, reset]);

  const watchedValues = useWatch({ control });

  const paletteForAccount = useAtomValue(
    normalizedGoogleColorsAtomFamily(accountId)
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

  const buildCloseSaveRequest = useCallback(
    (values: EventFormValues): CloseSaveRequest => {
      // If the user never interacted, do not send an update.
      if (!hasUserEditedRef.current) {
        return { type: "none" } satisfies CloseSaveRequest;
      }

      const temporalPayload = buildTemporalPayload(
        values,
        clampToStartIfNeeded
      );
      if (!temporalPayload) {
        return { type: "none" } satisfies CloseSaveRequest;
      }

      const isRecurring = Boolean(
        event.recurringEventId ||
          event.recurrence?.length ||
          masterQuery.data?.recurrence?.length
      );
      const defaultScope: RecurrenceScope = event.recurringEventId
        ? "this"
        : "all";

      // Prepare payload for mutation; recurrence scope is chosen after close.
      const variables: UpdateGoogleEventInput = {
        accountId,
        calendarId,
        eventId: event.id,
        recurringEventId: event.recurringEventId,
        event: {
          ...event,
          summary: values.summary.trim(),
          description: values.description ?? "",
          location: values.location ?? "",
          colorId: values.colorId ?? undefined,
          recurrence: values.recurrence ?? event.recurrence,
          start: {
            ...event.start,
            ...temporalPayload.startPayload,
          },
          end: {
            ...event.end,
            ...temporalPayload.endPayload,
          },
        },
      };

      return {
        type: "save",
        variables,
        isRecurring,
        defaultScope,
      };
    },
    [accountId, calendarId, clampToStartIfNeeded, event, masterQuery.data]
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
  const canEditRecurrence = Boolean(
    event.recurrence?.length ||
      event.recurringEventId ||
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
                  )?.[1]?.background ?? undefined,
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
          className="flex-1"
          onChange={(e) => {
            hasUserEditedRef.current = true;
            setValue("summary", e.target.value, { shouldDirty: true });
          }}
          placeholder="Event title"
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
          Location
        </Label>
        <Input
          onChange={(e) => {
            hasUserEditedRef.current = true;
            setValue("location", e.target.value, { shouldDirty: true });
          }}
          placeholder="Where?"
          value={watchedValues.location}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch
            checked={watchedValues.allDay}
            id="all-day-switch"
            onCheckedChange={(checked) => {
              hasUserEditedRef.current = true;
              setValue("allDay", checked, { shouldDirty: true });
            }}
          />
          <Label
            className="font-medium text-muted-foreground text-xs"
            htmlFor="all-day-switch"
          >
            All day
          </Label>
        </div>
        {canEditRecurrence ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={onRequestMove}
              size="sm"
              type="button"
              variant="outline"
            >
              Move…
            </Button>
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
          </div>
        ) : null}
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
                  {field.value ? format(field.value, "LLL dd") : "Start date"}
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
                  {field.value ? format(field.value, "LLL dd") : "End date"}
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
    </form>
  );
}
