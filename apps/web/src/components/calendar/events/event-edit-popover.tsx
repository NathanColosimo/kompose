"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, set } from "date-fns";
import { useAtomValue } from "jotai";
import { CalendarIcon, Clock3, Palette, Repeat, Timer } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Controller,
  type SubmitHandler,
  useForm,
  useWatch,
} from "react-hook-form";
import { normalizedGoogleColorsAtomFamily } from "@/atoms/google-colors";
import { googleCalendarsDataAtom } from "@/atoms/google-data";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateGoogleEventMutation } from "@/hooks/use-update-google-event-mutation";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";

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

type RecurrenceScope = "this" | "all" | "following";

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
  calendarKey: string;
  recurrenceScope: RecurrenceScope;
  recurrence: string[];
};

type CalendarOption = {
  accountId: string;
  calendarId: string;
  label: string;
};

const RECURRENCE_OPTIONS: { value: RecurrenceScope; label: string }[] = [
  { value: "this", label: "Only this occurrence" },
  { value: "all", label: "Entire series" },
  { value: "following", label: "This and following" },
];

type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | null;
const WEEKDAYS: Array<{ value: string; label: string }> = [
  { value: "MO", label: "Mon" },
  { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" },
  { value: "TH", label: "Thu" },
  { value: "FR", label: "Fri" },
  { value: "SA", label: "Sat" },
  { value: "SU", label: "Sun" },
];

type RecurrenceEnd =
  | { type: "none" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

const UNTIL_RULE_REGEX_DATEONLY = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_RULE_REGEX_FULL =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;

function untilRuleToInput(raw?: string | null): string {
  if (!raw) {
    return "";
  }
  // Support date-only (YYYYMMDD) or date-time with optional offset.
  const cleaned = raw.replace(/[-:]/g, "");
  // Date only
  const dateOnlyMatch = cleaned.match(UNTIL_RULE_REGEX_DATEONLY);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return `${y}-${m}-${d}T00:00`;
  }

  // Date + time with optional Z/offset
  const fullMatch = cleaned.match(UNTIL_RULE_REGEX_FULL);
  if (!fullMatch) {
    return "";
  }
  const [, y2, m2, d2, hh, mm, ss, offset] = fullMatch;
  const iso = `${y2}-${m2}-${d2}T${hh}:${mm}:${ss}${offset ?? "Z"}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function untilInputToRule(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  // input: local datetime yyyy-MM-ddTHH:mm
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = dt.getUTCFullYear();
  const m = pad(dt.getUTCMonth() + 1);
  const d = pad(dt.getUTCDate());
  const hh = pad(dt.getUTCHours());
  const mm = pad(dt.getUTCMinutes());
  const ss = pad(dt.getUTCSeconds());
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

// biome-ignore lint: RRULE parsing combines frequency, days, and end options.
function parseRecurrence(rule?: string): {
  freq: Frequency;
  byDay: string[];
  end: RecurrenceEnd;
} {
  if (!rule?.startsWith("RRULE:")) {
    return { freq: null, byDay: [], end: { type: "none" } };
  }
  const body = rule.replace("RRULE:", "");
  const parts = body.split(";");
  let freq: Frequency = null;
  let byDay: string[] = [];
  let until: string | null = null;
  let count: number | null = null;
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (
      key === "FREQ" &&
      (value === "DAILY" || value === "WEEKLY" || value === "MONTHLY")
    ) {
      freq = value;
    }
    if (key === "BYDAY" && value) {
      byDay = value.split(",");
    }
    if (key === "UNTIL" && value) {
      until = value;
    }
    if (key === "COUNT" && value) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        count = parsed;
      }
    }
  }
  let end: RecurrenceEnd = { type: "none" };
  if (until !== null) {
    end = { type: "until", date: until };
  } else if (count !== null) {
    end = { type: "count", count };
  }
  return { freq, byDay, end };
}

function buildRecurrenceRule(
  freq: Frequency,
  byDay: string[],
  end: RecurrenceEnd
): string | null {
  if (!freq) {
    return null;
  }
  const parts: string[] = [`FREQ=${freq}`];
  if (freq === "WEEKLY" && byDay.length > 0) {
    parts.push(`BYDAY=${byDay.join(",")}`);
  }
  if (end.type === "until") {
    parts.push(`UNTIL=${end.date}`);
  } else if (end.type === "count") {
    parts.push(`COUNT=${end.count}`);
  }
  return `RRULE:${parts.join(";")}`;
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
  const [endMode, setEndMode] = useState<RecurrenceEnd["type"]>(
    parsedRecurrence.end.type
  );
  const [endUntil, setEndUntil] = useState<string | null>(
    parsedRecurrence.end.type === "until" ? parsedRecurrence.end.date : null
  );
  const [endCount, setEndCount] = useState<string>(
    parsedRecurrence.end.type === "count"
      ? String(parsedRecurrence.end.count)
      : ""
  );

  useEffect(() => {
    setEndMode(parsedRecurrence.end.type);
    setEndUntil(
      parsedRecurrence.end.type === "until" ? parsedRecurrence.end.date : null
    );
    setEndCount(
      parsedRecurrence.end.type === "count"
        ? String(parsedRecurrence.end.count)
        : ""
    );
  }, [parsedRecurrence.end]);

  const applyChange = useCallback(
    (next: { freq?: Frequency; byDay?: string[]; end?: RecurrenceEnd }) => {
      const nextRule = buildRecurrenceRule(
        next.freq ?? parsedRecurrence.freq,
        next.byDay ?? parsedRecurrence.byDay,
        next.end ?? parsedRecurrence.end
      );
      onChange(nextRule);
    },
    [
      onChange,
      parsedRecurrence.byDay,
      parsedRecurrence.end,
      parsedRecurrence.freq,
    ]
  );

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
            const nextFreq = (e.target.value || null) as Frequency;
            applyChange({ freq: nextFreq });
          }}
          value={parsedRecurrence.freq ?? ""}
        >
          <option value="">None</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </select>
      </div>

      {parsedRecurrence.freq === "WEEKLY" && (
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const active = parsedRecurrence.byDay.includes(day.value);
            return (
              <Button
                key={day.value}
                onClick={() => {
                  const next = active
                    ? parsedRecurrence.byDay.filter((d) => d !== day.value)
                    : [...parsedRecurrence.byDay, day.value];
                  applyChange({ byDay: next });
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
              setEndMode("none");
              applyChange({ end: { type: "none" } });
            }}
            size="sm"
            type="button"
            variant={endMode === "none" ? "secondary" : "outline"}
          >
            No end
          </Button>
          <Button
            onClick={() => {
              const fallback =
                endUntil ??
                untilInputToRule(
                  `${new Date().toISOString().slice(0, 10)}T00:00`
                ) ??
                `${new Date().toISOString().slice(0, 10)}T000000Z`;
              setEndMode("until");
              setEndUntil(fallback);
              applyChange({ end: { type: "until", date: fallback } });
            }}
            size="sm"
            type="button"
            variant={endMode === "until" ? "secondary" : "outline"}
          >
            On date
          </Button>
          <Button
            onClick={() => {
              setEndMode("count");
              const nextCount = endCount || "5";
              setEndCount(nextCount);
              applyChange({ end: { type: "count", count: Number(nextCount) } });
            }}
            size="sm"
            type="button"
            variant={endMode === "count" ? "secondary" : "outline"}
          >
            After N
          </Button>
        </div>

        {endMode === "until" ? (
          <Input
            className="w-44 text-xs"
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                setEndUntil(null);
                applyChange({ end: { type: "none" } });
                return;
              }
              const normalized = untilInputToRule(val);
              if (!normalized) {
                return;
              }
              setEndUntil(normalized);
              applyChange({ end: { type: "until", date: normalized } });
            }}
            type="datetime-local"
            value={endUntil ? untilRuleToInput(endUntil) : ""}
          />
        ) : null}

        {endMode === "count" ? (
          <div className="flex items-center gap-2">
            <Input
              className="w-20 text-xs"
              min={1}
              onChange={(e) => {
                const val = e.target.value;
                setEndCount(val);
                const parsed = Number.parseInt(val, 10);
                if (Number.isFinite(parsed) && parsed > 0) {
                  applyChange({ end: { type: "count", count: parsed } });
                }
              }}
              type="number"
              value={endCount}
            />
            <span className="text-muted-foreground text-xs">occurrences</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type TemporalPayload = {
  startPayload: { date?: string; dateTime?: string };
  endPayload: { date?: string; dateTime?: string };
  startDateTime: Date | null;
  isAllDay: boolean;
  occurrenceStart: Date;
};

function buildDateTimeValue(date: Date | null, time: string) {
  if (!(date && time)) {
    return null;
  }
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return set(new Date(date), {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  });
}

function buildTemporalPayload(
  values: EventFormValues,
  clamp: (
    start: Date | null,
    end: Date | null
  ) => {
    start: Date | null;
    end: Date | null;
  }
): TemporalPayload | null {
  const isAllDayEvent = values.allDay;
  const startDate = values.startDate;
  const endDate = values.endDate ?? values.startDate;
  if (!startDate) {
    return null;
  }

  const resolvedTimes = clamp(startDate, endDate);

  const startDateTime = buildDateTimeValue(
    resolvedTimes.start,
    values.startTime
  );
  const endDateTime = buildDateTimeValue(resolvedTimes.end, values.endTime);

  const startPayload = isAllDayEvent
    ? { date: format(startDate, "yyyy-MM-dd") }
    : { dateTime: startDateTime?.toISOString() };
  const endPayload = isAllDayEvent
    ? {
        date: resolvedTimes.end
          ? format(addDays(resolvedTimes.end, 1), "yyyy-MM-dd")
          : undefined,
      }
    : { dateTime: endDateTime?.toISOString() };

  return {
    startPayload,
    endPayload,
    startDateTime,
    isAllDay: isAllDayEvent,
    occurrenceStart: startDateTime ?? startDate,
  };
}

function buildCalendarKey(accountId: string, calendarId: string) {
  return `${accountId}:${calendarId}`;
}

function parseCalendarKey(key: string): CalendarOption | null {
  const [accountId, calendarId] = key.split(":");
  if (!(accountId && calendarId)) {
    return null;
  }
  return { accountId, calendarId, label: "" };
}

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
  const submitRef = useRef<(() => void) | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && submitRef.current) {
      submitRef.current();
    }
    setOpen(nextOpen);
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
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
          onRegisterSubmit={(fn) => {
            submitRef.current = fn;
          }}
          start={start}
        />
      </PopoverContent>
    </Popover>
  );
}

function EventEditForm({
  event,
  accountId,
  calendarId,
  start,
  end,
  onRegisterSubmit,
}: {
  event: GoogleEvent;
  accountId: string;
  calendarId: string;
  start: Date;
  end: Date;
  onRegisterSubmit: (fn: () => void) => void;
}) {
  const calendars = useAtomValue(googleCalendarsDataAtom);
  const updateEvent = useUpdateGoogleEventMutation();
  const shouldFetchMaster =
    !event.recurrence?.length && Boolean(event.recurringEventId);
  const masterQuery = useQuery({
    queryKey: [
      "google-event-master",
      accountId,
      event.recurringEventId ?? "single",
    ],
    queryFn: () =>
      orpc.googleCal.events.get.call({
        accountId,
        calendarId,
        eventId: event.recurringEventId ?? event.id,
      }),
    enabled: shouldFetchMaster,
    staleTime: 5 * 60 * 1000,
  });

  const calendarOptions = useMemo<CalendarOption[]>(
    () =>
      calendars.map((c) => ({
        accountId: c.accountId,
        calendarId: c.calendar.id,
        label: c.calendar.summary ?? "Calendar",
      })),
    [calendars]
  );

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
      calendarKey: buildCalendarKey(accountId, calendarId),
      recurrenceScope: event.recurringEventId ? "this" : "all",
      recurrence: recurrenceSource,
    }),
    [
      accountId,
      calendarId,
      event.colorId,
      event.description,
      event.location,
      event.recurringEventId,
      event.summary,
      recurrenceSource,
      initialEndDate,
      initialStartDate,
      isAllDay,
    ]
  );

  const { control, handleSubmit, reset, setValue, getValues } =
    useForm<EventFormValues>({
      defaultValues: initialValues,
    });

  // Keep form synced if event changes underneath.
  useEffect(() => {
    reset(initialValues, { keepDirty: false });
  }, [initialValues, reset]);

  const watchedValues = useWatch({ control });

  const selectedCalendar = useMemo(() => {
    const calendarKeyValue =
      watchedValues.calendarKey ?? buildCalendarKey(accountId, calendarId);
    const parsed = parseCalendarKey(calendarKeyValue);
    if (!parsed) {
      return { accountId, calendarId };
    }
    return {
      accountId: parsed.accountId,
      calendarId: parsed.calendarId,
    };
  }, [accountId, calendarId, watchedValues.calendarKey]);

  const paletteForAccount = useAtomValue(
    normalizedGoogleColorsAtomFamily(selectedCalendar.accountId)
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
      setValue(field, "", { shouldDirty: true });
      return;
    }
    const [hours, minutes] = value.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return;
    }

    setValue(
      field,
      `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
      {
        shouldDirty: true,
      }
    );
  };

  const submit = useCallback<SubmitHandler<EventFormValues>>(
    (values) => {
      const parsedCalendar = parseCalendarKey(values.calendarKey);
      const targetCalendar = parsedCalendar?.calendarId ?? calendarId;

      const temporalPayload = buildTemporalPayload(
        values,
        clampToStartIfNeeded
      );
      if (!temporalPayload) {
        return;
      }

      const recurrenceScope = values.recurrenceScope;

      // Prepare payload for mutation; leave recurrence untouched unless provided.
      updateEvent.mutate({
        accountId,
        calendarId,
        targetCalendarId: targetCalendar,
        eventId: event.id,
        recurringEventId: event.recurringEventId,
        recurrenceScope,
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
      });
    },
    [accountId, calendarId, clampToStartIfNeeded, event, updateEvent]
  );

  // Register submit callback so popover close saves once.
  useEffect(() => {
    onRegisterSubmit(() => {
      submit(getValues());
    });
  }, [getValues, onRegisterSubmit, submit]);

  const startTimeValue = watchedValues.allDay ? "" : watchedValues.startTime;
  const endTimeValue = watchedValues.allDay ? "" : watchedValues.endTime;
  const recurrenceRule = watchedValues.recurrence?.[0];

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
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
                onClick={() =>
                  setValue("colorId", undefined, { shouldDirty: true })
                }
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
          onChange={(e) =>
            setValue("summary", e.target.value, { shouldDirty: true })
          }
          placeholder="Event title"
          value={watchedValues.summary}
        />
      </div>

      <Textarea
        onChange={(e) =>
          setValue("description", e.target.value, { shouldDirty: true })
        }
        placeholder="Add details..."
        value={watchedValues.description}
      />

      <RecurrenceEditor
        onChange={(rule) =>
          setValue("recurrence", rule ? [rule] : [], { shouldDirty: true })
        }
        recurrenceRule={recurrenceRule}
        visible={Boolean(
          event.recurrence?.length ||
            event.recurringEventId ||
            masterQuery.data?.recurrence?.length
        )}
      />

      <div className="space-y-2">
        <Label className="font-medium text-muted-foreground text-xs">
          Location
        </Label>
        <Input
          onChange={(e) =>
            setValue("location", e.target.value, { shouldDirty: true })
          }
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
            onCheckedChange={(checked) =>
              setValue("allDay", checked, { shouldDirty: true })
            }
          />
          <Label
            className="font-medium text-muted-foreground text-xs"
            htmlFor="all-day-switch"
          >
            All day
          </Label>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Repeat className="h-4 w-4" />
          <span>Recurrence scope</span>
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

      {Boolean(event.recurringEventId || event.recurrence?.length) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Repeat className="h-4 w-4" />
            <span>Recurrence</span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {RECURRENCE_OPTIONS.map((option) => {
              const isSelected = watchedValues.recurrenceScope === option.value;
              return (
                <Button
                  className={cn(
                    "justify-start text-left text-xs",
                    isSelected ? "bg-muted" : ""
                  )}
                  key={option.value}
                  onClick={() =>
                    setValue("recurrenceScope", option.value, {
                      shouldDirty: true,
                    })
                  }
                  type="button"
                  variant={isSelected ? "secondary" : "outline"}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button className="justify-start gap-2 text-xs" variant="outline">
              {calendarOptions.find(
                (option) =>
                  option.accountId === selectedCalendar.accountId &&
                  option.calendarId === selectedCalendar.calendarId
              )?.label ?? "Select calendar"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[280px] space-y-1 p-2">
            {calendarOptions.map((option) => {
              const key = buildCalendarKey(option.accountId, option.calendarId);
              const isActive = watchedValues.calendarKey === key;
              return (
                <Button
                  className={cn(
                    "w-full justify-start text-left text-xs",
                    isActive ? "bg-muted" : ""
                  )}
                  key={key}
                  onClick={() =>
                    setValue("calendarKey", key, { shouldDirty: true })
                  }
                  variant="ghost"
                >
                  {option.label}
                </Button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>
    </form>
  );
}
