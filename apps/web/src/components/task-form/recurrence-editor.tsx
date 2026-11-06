"use client";

import type { TaskRecurrence } from "@kompose/api/routers/task/contract";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import {
  buildTaskRecurrence,
  getTaskRecurrenceDisplayText,
  getTaskRecurrenceEditorState,
  getTaskRecurrenceIntervalLabel,
  TASK_RECURRENCE_DAYS,
  type TaskRecurrenceDayCode,
  type TaskRecurrenceEditorState,
  type TaskRecurrenceEnd,
  type TaskRecurrenceFrequency,
  toggleTaskRecurrenceDay,
} from "@kompose/state/task-recurrence";
import { useAtomValue } from "jotai";
import { CalendarIcon, Repeat, X } from "lucide-react";
import { useCallback, useMemo, useReducer, useState } from "react";
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

type RecurrenceAction =
  | { type: "reset"; state: TaskRecurrenceEditorState }
  | { type: "set-freq"; freq: TaskRecurrenceFrequency }
  | { type: "set-interval"; interval: number }
  | { type: "toggle-day"; day: TaskRecurrenceDayCode }
  | { type: "set-month-day"; byMonthDay: number }
  | { type: "set-end"; end: TaskRecurrenceEnd };

function recurrenceReducer(
  state: TaskRecurrenceEditorState,
  action: RecurrenceAction
): TaskRecurrenceEditorState {
  switch (action.type) {
    case "reset":
      return action.state;
    case "set-freq":
      return { ...state, freq: action.freq };
    case "set-interval":
      return { ...state, interval: action.interval };
    case "toggle-day":
      return {
        ...state,
        byDay: toggleTaskRecurrenceDay(state.byDay, action.day),
      };
    case "set-month-day":
      return { ...state, byMonthDay: action.byMonthDay };
    case "set-end":
      return { ...state, end: action.end };
    default:
      return state;
  }
}

interface RecurrenceEditorProps {
  onChange: (recurrence: TaskRecurrence | null) => void;
  /** Reference date for defaults (typically the task's startDate) */
  referenceDate?: Temporal.PlainDate | null;
  value: TaskRecurrence | null;
}

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
          <Repeat className="size-4 shrink-0" />
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

function RecurrenceForm({
  value,
  onChange,
  onClose,
  referenceDate,
}: RecurrenceEditorProps & { onClose: () => void }) {
  const initialFields = useMemo(
    () => getTaskRecurrenceEditorState(value, referenceDate),
    [referenceDate, value]
  );

  const [state, dispatch] = useReducer(recurrenceReducer, initialFields);
  const { freq, interval, byDay, byMonthDay, end } = state;
  const timeZone = useAtomValue(timezoneAtom);

  const handleApply = useCallback(() => {
    onChange(buildTaskRecurrence(state));
    onClose();
  }, [state, onChange, onClose]);

  const handleClear = useCallback(() => {
    onChange(null);
    onClose();
  }, [onChange, onClose]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-muted-foreground text-xs">Repeat</Label>
        <Select
          onValueChange={(v) =>
            dispatch({ freq: v as TaskRecurrenceFrequency, type: "set-freq" })
          }
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
            dispatch({
              interval: Number.parseInt(event.target.value, 10) || 1,
              type: "set-interval",
            })
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
                  className="size-8 rounded-full p-0 text-xs"
                  key={day.value}
                  onClick={() =>
                    dispatch({ day: day.value, type: "toggle-day" })
                  }
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
              dispatch({
                byMonthDay: Number.parseInt(event.target.value, 10) || 1,
                type: "set-month-day",
              })
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
            onClick={() =>
              dispatch({ end: { kind: "never" }, type: "set-end" })
            }
            size="sm"
            type="button"
            variant={end.kind === "never" ? "default" : "outline"}
          >
            Never
          </Button>

          <div className="flex items-center gap-2">
            <Button
              className="h-8 shrink-0 text-xs"
              onClick={() =>
                dispatch({
                  end:
                    end.kind === "until"
                      ? end
                      : {
                          date:
                            referenceDate ??
                            Temporal.Now.plainDateISO(timeZone),
                          kind: "until",
                        },
                  type: "set-end",
                })
              }
              size="sm"
              type="button"
              variant={end.kind === "until" ? "default" : "outline"}
            >
              On
            </Button>
            {end.kind === "until" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    className="h-7 gap-1.5 px-2 text-xs"
                    variant="outline"
                  >
                    <CalendarIcon className="size-3" />
                    {formatPlainDate(end.date, {
                      day: "numeric",
                      month: "short",
                    })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    onSelect={(date) => {
                      if (date) {
                        dispatch({
                          end: {
                            date: pickerDateToTemporal(date),
                            kind: "until",
                          },
                          type: "set-end",
                        });
                      }
                    }}
                    required
                    selected={temporalToPickerDate(end.date)}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              className="h-8 shrink-0 text-xs"
              onClick={() =>
                dispatch({
                  end:
                    end.kind === "count" ? end : { count: 10, kind: "count" },
                  type: "set-end",
                })
              }
              size="sm"
              type="button"
              variant={end.kind === "count" ? "default" : "outline"}
            >
              After
            </Button>
            {end.kind === "count" && (
              <>
                <Input
                  className="h-7 w-14 px-2 text-xs"
                  min={1}
                  onChange={(event) =>
                    dispatch({
                      end: {
                        count: Number.parseInt(event.target.value, 10) || 1,
                        kind: "count",
                      },
                      type: "set-end",
                    })
                  }
                  type="number"
                  value={end.count}
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
          <X className="size-3.5" />
          Clear
        </Button>
        <Button onClick={handleApply} size="sm" type="button">
          Apply
        </Button>
      </div>
    </div>
  );
}
