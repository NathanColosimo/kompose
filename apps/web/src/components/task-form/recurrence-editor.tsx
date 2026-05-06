"use client";

import type { TaskRecurrence } from "@kompose/api/routers/task/contract";
import {
  buildTaskRecurrence,
  getTaskRecurrenceDisplayText,
  getTaskRecurrenceEditorState,
  getTaskRecurrenceIntervalLabel,
  TASK_RECURRENCE_DAYS,
  type TaskRecurrenceDayCode,
  type TaskRecurrenceEndType,
  type TaskRecurrenceFrequency,
  toggleTaskRecurrenceDay,
} from "@kompose/state/task-recurrence";
import { CalendarIcon, Repeat, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Temporal } from "temporal-polyfill";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatPlainDate,
  pickerDateToTemporal,
  temporalToPickerDate,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";

interface RecurrenceEditorProps {
  /** Called when recurrence changes */
  onChange: (recurrence: TaskRecurrence | null) => void;
  /** Reference date for defaults (typically the task's startDate) */
  referenceDate?: Temporal.PlainDate | null;
  /** Current recurrence value (null = no recurrence) */
  value: TaskRecurrence | null;
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

  const displayText = getTaskRecurrenceDisplayText(value);

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
          open={open}
          referenceDate={referenceDate}
          value={value}
        />
      </PopoverContent>
    </Popover>
  );
}

function RecurrenceForm({
  value,
  onChange,
  onClose,
  open,
  referenceDate,
}: RecurrenceEditorProps & { onClose: () => void; open: boolean }) {
  const initialState = useMemo(
    () => getTaskRecurrenceEditorState(value, referenceDate),
    [referenceDate, value]
  );

  const [freq, setFreq] = useState<TaskRecurrenceFrequency>(initialState.freq);
  const [interval, setInterval] = useState(initialState.interval);
  const [byDay, setByDay] = useState<TaskRecurrenceDayCode[]>(
    initialState.byDay
  );
  const [byMonthDay, setByMonthDay] = useState(initialState.byMonthDay);
  const [endType, setEndType] = useState<TaskRecurrenceEndType>(
    initialState.endType
  );
  const [until, setUntil] = useState<Temporal.PlainDate | null>(
    initialState.until
  );
  const [count, setCount] = useState(initialState.count);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFreq(initialState.freq);
    setInterval(initialState.interval);
    setByDay(initialState.byDay);
    setByMonthDay(initialState.byMonthDay);
    setEndType(initialState.endType);
    setUntil(initialState.until);
    setCount(initialState.count);
  }, [initialState, open]);

  const toggleDay = useCallback((day: TaskRecurrenceDayCode) => {
    setByDay((prev) => toggleTaskRecurrenceDay(prev, day));
  }, []);

  const handleApply = useCallback(() => {
    onChange(
      buildTaskRecurrence({
        freq,
        interval,
        byDay,
        byMonthDay,
        endType,
        until,
        count,
      })
    );
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

  const handleClear = useCallback(() => {
    onChange(null);
    onClose();
  }, [onChange, onClose]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-muted-foreground text-xs">Repeat</Label>
        <Select
          onValueChange={(v) => setFreq(v as TaskRecurrenceFrequency)}
          value={freq}
        >
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DAILY">Daily</SelectItem>
            <SelectItem value="WEEKLY">Weekly</SelectItem>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
            <SelectItem value="YEARLY">Yearly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Label
          className="text-muted-foreground text-xs"
          htmlFor="recurrence-interval"
        >
          Every
        </Label>
        <Input
          className="h-7 w-14 px-2 text-xs"
          id="recurrence-interval"
          min={1}
          onChange={(event) =>
            setInterval(Number.parseInt(event.target.value, 10) || 1)
          }
          type="number"
          value={interval}
        />
        <span className="text-muted-foreground text-xs">
          {getTaskRecurrenceIntervalLabel(freq, interval)}
        </span>
      </div>

      {freq === "WEEKLY" && (
        <div className="space-y-2">
          <span className="text-muted-foreground text-xs">On days</span>
          <div className="flex gap-1">
            {TASK_RECURRENCE_DAYS.map((day) => {
              const active = byDay.includes(day.value);
              return (
                <Button
                  className="h-8 w-8 rounded-full p-0 text-xs"
                  key={day.value}
                  onClick={() => toggleDay(day.value)}
                  size="icon"
                  type="button"
                  variant={active ? "default" : "outline"}
                >
                  {day.shortLabel}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {freq === "MONTHLY" && (
        <div className="flex items-center gap-2">
          <Label
            className="text-muted-foreground text-xs"
            htmlFor="recurrence-monthday"
          >
            On day
          </Label>
          <Input
            className="h-7 w-14 px-2 text-xs"
            id="recurrence-monthday"
            max={31}
            min={1}
            onChange={(event) =>
              setByMonthDay(Number.parseInt(event.target.value, 10) || 1)
            }
            type="number"
            value={byMonthDay}
          />
          <span className="text-muted-foreground text-xs">of the month</span>
        </div>
      )}

      <div className="space-y-2">
        <span className="text-muted-foreground text-xs">Ends</span>
        <div className="space-y-2">
          <Button
            className="h-8 w-full justify-start text-xs"
            onClick={() => setEndType("never")}
            size="sm"
            type="button"
            variant={endType === "never" ? "default" : "outline"}
          >
            Never
          </Button>

          <div className="flex items-center gap-2">
            <Button
              className="h-8 shrink-0 text-xs"
              onClick={() => setEndType("until")}
              size="sm"
              type="button"
              variant={endType === "until" ? "default" : "outline"}
            >
              On
            </Button>
            {endType === "until" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    className="h-7 gap-1.5 px-2 text-xs"
                    variant="outline"
                  >
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
              className="h-8 shrink-0 text-xs"
              onClick={() => setEndType("count")}
              size="sm"
              type="button"
              variant={endType === "count" ? "default" : "outline"}
            >
              After
            </Button>
            {endType === "count" && (
              <>
                <Input
                  className="h-7 w-14 px-2 text-xs"
                  min={1}
                  onChange={(event) =>
                    setCount(Number.parseInt(event.target.value, 10) || 1)
                  }
                  type="number"
                  value={count}
                />
                <span className="text-muted-foreground text-xs">times</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between border-t pt-3">
        <Button
          className="gap-1 text-destructive"
          onClick={handleClear}
          size="sm"
          type="button"
          variant="ghost"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
        <Button onClick={handleApply} size="sm" type="button">
          Apply
        </Button>
      </div>
    </div>
  );
}
