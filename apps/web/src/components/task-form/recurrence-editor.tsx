"use client";

import type { TaskRecurrence } from "@kompose/api/routers/task/contract";
import { CalendarIcon, Repeat, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";

/** Days of the week for weekly recurrence */
const DAYS = [
  { value: "MO", label: "M" },
  { value: "TU", label: "T" },
  { value: "WE", label: "W" },
  { value: "TH", label: "T" },
  { value: "FR", label: "F" },
  { value: "SA", label: "S" },
  { value: "SU", label: "S" },
] as const;

type DayCode = (typeof DAYS)[number]["value"];
type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

interface RecurrenceEditorProps {
  /** Current recurrence value (null = no recurrence) */
  value: TaskRecurrence | null;
  /** Called when recurrence changes */
  onChange: (recurrence: TaskRecurrence | null) => void;
  /** Reference date for defaults (typically the task's startDate) */
  referenceDate?: Temporal.PlainDate | null;
}

/**
 * Recurrence pattern editor for tasks.
 * Supports daily, weekly (with day selection), monthly, and yearly patterns.
 */
export function RecurrenceEditor({
  value,
  onChange,
  referenceDate,
}: RecurrenceEditorProps) {
  const [open, setOpen] = useState(false);

  // Get display text for the current recurrence
  const displayText = getRecurrenceDisplayText(value);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            "justify-start gap-2 text-left font-medium text-xs",
            !value && "text-muted-foreground"
          )}
          variant="outline"
        >
          <Repeat className="h-4 w-4 shrink-0" />
          <span className="truncate">{displayText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] space-y-4 p-4">
        <RecurrenceForm
          onChange={onChange}
          onClose={() => setOpen(false)}
          referenceDate={referenceDate}
          value={value}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Internal form for editing recurrence details */
function RecurrenceForm({
  value,
  onChange,
  onClose,
  referenceDate,
}: RecurrenceEditorProps & { onClose: () => void }) {
  // Local state for building the recurrence
  const [freq, setFreq] = useState<Frequency>(value?.freq ?? "WEEKLY");
  const [interval, setInterval] = useState(getInterval(value));
  const [byDay, setByDay] = useState<DayCode[]>(getByDay(value, referenceDate));
  const [byMonthDay, setByMonthDay] = useState(
    getByMonthDay(value, referenceDate)
  );
  const [endType, setEndType] = useState<"never" | "until" | "count">(
    getEndType(value)
  );
  const [until, setUntil] = useState<Temporal.PlainDate | null>(
    getUntilDate(value)
  );
  const [count, setCount] = useState(value?.count ?? 10);

  // Toggle a day in the byDay array
  const toggleDay = useCallback((day: DayCode) => {
    setByDay((prev) => {
      if (prev.includes(day)) {
        // Don't allow removing the last day
        if (prev.length === 1) {
          return prev;
        }
        return prev.filter((d) => d !== day);
      }
      return [...prev, day];
    });
  }, []);

  // Build and apply the recurrence
  const handleApply = useCallback(() => {
    const baseRecurrence = buildRecurrence(
      freq,
      interval,
      byDay,
      byMonthDay,
      endType,
      until,
      count
    );
    onChange(baseRecurrence);
    onClose();
  }, [
    freq,
    interval,
    byDay,
    byMonthDay,
    endType,
    until,
    count,
    onChange,
    onClose,
  ]);

  // Clear recurrence
  const handleClear = useCallback(() => {
    onChange(null);
    onClose();
  }, [onChange, onClose]);

  return (
    <div className="space-y-4">
      {/* Frequency selection */}
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs">Repeat</span>
        <div className="flex flex-wrap gap-2">
          {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const).map((f) => (
            <Button
              className={cn(
                "h-auto px-3 py-1.5 text-sm",
                freq === f && "border-primary bg-primary/10"
              )}
              key={f}
              onClick={() => setFreq(f)}
              type="button"
              variant="outline"
            >
              {f.charAt(0) + f.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
      </div>

      {/* Interval */}
      <div className="flex items-center gap-2">
        <Label
          className="text-muted-foreground text-xs"
          htmlFor="recurrence-interval"
        >
          Every
        </Label>
        <Input
          className="w-16"
          id="recurrence-interval"
          min={1}
          onChange={(e) =>
            setInterval(Number.parseInt(e.target.value, 10) || 1)
          }
          type="number"
          value={interval}
        />
        <span className="text-muted-foreground text-sm">
          {getIntervalLabel(freq, interval)}
        </span>
      </div>

      {/* Weekly: day selection */}
      {freq === "WEEKLY" && (
        <div className="space-y-2">
          <span className="text-muted-foreground text-xs">On days</span>
          <div className="flex gap-1">
            {DAYS.map((day) => (
              <button
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors",
                  byDay.includes(day.value)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                )}
                key={day.value}
                onClick={() => toggleDay(day.value)}
                type="button"
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Monthly: day of month */}
      {freq === "MONTHLY" && (
        <div className="flex items-center gap-2">
          <Label
            className="text-muted-foreground text-xs"
            htmlFor="recurrence-monthday"
          >
            On day
          </Label>
          <Input
            className="w-16"
            id="recurrence-monthday"
            max={31}
            min={1}
            onChange={(e) =>
              setByMonthDay(Number.parseInt(e.target.value, 10) || 1)
            }
            type="number"
            value={byMonthDay}
          />
          <span className="text-muted-foreground text-sm">of the month</span>
        </div>
      )}

      {/* End options */}
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs">Ends</span>
        <div className="space-y-2">
          <Button
            className={cn(
              "h-auto justify-start gap-2 px-3 py-1.5 text-sm",
              endType === "never" && "border-primary bg-primary/10"
            )}
            onClick={() => setEndType("never")}
            type="button"
            variant="outline"
          >
            Never
          </Button>
          <div className="flex items-center gap-2">
            <Button
              className={cn(
                "h-auto justify-start gap-2 px-3 py-1.5 text-sm",
                endType === "until" && "border-primary bg-primary/10"
              )}
              onClick={() => setEndType("until")}
              type="button"
              variant="outline"
            >
              On
            </Button>
            {endType === "until" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button className="h-7 gap-1 px-2 text-xs" variant="outline">
                    <CalendarIcon className="h-3 w-3" />
                    {until
                      ? formatPlainDate(until, {
                          month: "short",
                          day: "numeric",
                        })
                      : "Select"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    onSelect={(date) =>
                      setUntil(date ? pickerDateToTemporal(date) : null)
                    }
                    selected={until ? temporalToPickerDate(until) : undefined}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              className={cn(
                "h-auto justify-start gap-2 px-3 py-1.5 text-sm",
                endType === "count" && "border-primary bg-primary/10"
              )}
              onClick={() => setEndType("count")}
              type="button"
              variant="outline"
            >
              After
            </Button>
            {endType === "count" && (
              <>
                <Input
                  className="h-7 w-14 px-2"
                  min={1}
                  onChange={(e) =>
                    setCount(Number.parseInt(e.target.value, 10) || 1)
                  }
                  type="number"
                  value={count}
                />
                <span className="text-sm">occurrences</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-2">
        <Button
          className="gap-1 text-destructive"
          onClick={handleClear}
          type="button"
          variant="ghost"
        >
          <X className="h-4 w-4" />
          Clear
        </Button>
        <Button onClick={handleApply} type="button">
          Apply
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Helper functions
// ============================================================================

function getRecurrenceDisplayText(value: TaskRecurrence | null): string {
  if (!value) {
    return "Repeat";
  }

  const interval = getInterval(value);
  const prefix = interval > 1 ? `Every ${interval} ` : "";

  switch (value.freq) {
    case "DAILY":
      return interval > 1 ? `${prefix}days` : "Daily";
    case "WEEKLY": {
      const days = value.byDay.join(", ");
      return interval > 1 ? `${prefix}weeks on ${days}` : `Weekly on ${days}`;
    }
    case "MONTHLY":
      return interval > 1 ? `${prefix}months` : "Monthly";
    case "YEARLY":
      return interval > 1 ? `${prefix}years` : "Yearly";
    default:
      return "Repeat";
  }
}

function getInterval(value: TaskRecurrence | null): number {
  return value?.interval ?? 1;
}

function getByDay(
  value: TaskRecurrence | null,
  referenceDate?: Temporal.PlainDate | null
): DayCode[] {
  if (value?.freq === "WEEKLY") {
    return value.byDay as DayCode[];
  }
  // Default to the reference date's day of week, or Monday
  if (referenceDate) {
    const dayIndex = referenceDate.dayOfWeek; // 1=Monday, 7=Sunday
    return [DAYS[dayIndex - 1].value];
  }
  return ["MO"];
}

function getByMonthDay(
  value: TaskRecurrence | null,
  referenceDate?: Temporal.PlainDate | null
): number {
  if (value?.freq === "MONTHLY") {
    return value.byMonthDay;
  }
  return referenceDate?.day ?? 1;
}

function getEndType(value: TaskRecurrence | null): "never" | "until" | "count" {
  if (value?.until) {
    return "until";
  }
  if (value?.count) {
    return "count";
  }
  return "never";
}

function getUntilDate(value: TaskRecurrence | null): Temporal.PlainDate | null {
  if (value?.until) {
    return Temporal.PlainDate.from(value.until);
  }
  return null;
}

function getIntervalLabel(freq: Frequency, interval: number): string {
  const labels: Record<Frequency, [string, string]> = {
    DAILY: ["day", "days"],
    WEEKLY: ["week", "weeks"],
    MONTHLY: ["month", "months"],
    YEARLY: ["year", "years"],
  };
  return interval === 1 ? labels[freq][0] : labels[freq][1];
}

function buildRecurrence(
  freq: Frequency,
  interval: number,
  byDay: DayCode[],
  byMonthDay: number,
  endType: "never" | "until" | "count",
  until: Temporal.PlainDate | null,
  count: number
): TaskRecurrence {
  // Build end options
  const endOptions: { until?: string; count?: number } = {};
  if (endType === "until" && until) {
    endOptions.until = until.toString();
  } else if (endType === "count") {
    endOptions.count = count;
  }

  // Build frequency-specific recurrence
  switch (freq) {
    case "DAILY":
      return { freq: "DAILY", interval, ...endOptions };
    case "WEEKLY":
      return { freq: "WEEKLY", interval, byDay, ...endOptions };
    case "MONTHLY":
      return { freq: "MONTHLY", interval, byMonthDay, ...endOptions };
    case "YEARLY":
      return { freq: "YEARLY", interval, ...endOptions };
    default:
      return { freq: "DAILY", interval, ...endOptions };
  }
}
