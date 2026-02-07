import type {
  TaskRecurrence,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";

export const TASK_RECURRENCE_DAYS = [
  { value: "MO", label: "Mon", shortLabel: "M" },
  { value: "TU", label: "Tue", shortLabel: "T" },
  { value: "WE", label: "Wed", shortLabel: "W" },
  { value: "TH", label: "Thu", shortLabel: "T" },
  { value: "FR", label: "Fri", shortLabel: "F" },
  { value: "SA", label: "Sat", shortLabel: "S" },
  { value: "SU", label: "Sun", shortLabel: "S" },
] as const;

export type TaskRecurrenceDayCode =
  (typeof TASK_RECURRENCE_DAYS)[number]["value"];
export type TaskRecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type TaskRecurrenceEndType = "never" | "until" | "count";

export interface TaskRecurrenceEditorState {
  freq: TaskRecurrenceFrequency;
  interval: number;
  byDay: TaskRecurrenceDayCode[];
  byMonthDay: number;
  endType: TaskRecurrenceEndType;
  until: Temporal.PlainDate | null;
  count: number;
}

function normalizePositiveInt(value: number | undefined, fallback = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : fallback;
}

function clampMonthDay(day: number | undefined): number {
  if (typeof day !== "number" || !Number.isFinite(day)) {
    return 1;
  }
  const rounded = Math.round(day);
  return Math.max(1, Math.min(31, rounded));
}

function defaultByDay(
  referenceDate?: Temporal.PlainDate | null
): TaskRecurrenceDayCode[] {
  if (!referenceDate) {
    return ["MO"];
  }
  const index = referenceDate.dayOfWeek - 1;
  const fallback = TASK_RECURRENCE_DAYS[index];
  return [fallback?.value ?? "MO"];
}

function normalizeByDay(byDay: string[] | undefined): TaskRecurrenceDayCode[] {
  const valid = new Set(
    TASK_RECURRENCE_DAYS.map((day) => day.value)
  ) as Set<TaskRecurrenceDayCode>;
  const selected = (byDay ?? []).filter((day): day is TaskRecurrenceDayCode =>
    valid.has(day as TaskRecurrenceDayCode)
  );
  if (selected.length > 0) {
    return selected;
  }
  return ["MO"];
}

export function getTaskRecurrenceEditorState(
  value: TaskRecurrence | null,
  referenceDate?: Temporal.PlainDate | null
): TaskRecurrenceEditorState {
  const endType: TaskRecurrenceEndType = value?.until
    ? "until"
    : value?.count
      ? "count"
      : "never";

  return {
    freq: (value?.freq ?? "WEEKLY") as TaskRecurrenceFrequency,
    interval: normalizePositiveInt(value?.interval, 1),
    byDay:
      value?.freq === "WEEKLY"
        ? normalizeByDay(value.byDay)
        : defaultByDay(referenceDate),
    byMonthDay:
      value?.freq === "MONTHLY"
        ? clampMonthDay(value.byMonthDay)
        : clampMonthDay(referenceDate?.day ?? 1),
    endType,
    until: value?.until ? Temporal.PlainDate.from(value.until) : null,
    count: normalizePositiveInt(value?.count, 10),
  };
}

export function buildTaskRecurrence(
  value: TaskRecurrenceEditorState
): TaskRecurrence {
  const interval = normalizePositiveInt(value.interval, 1);
  const count = normalizePositiveInt(value.count, 1);

  const end: { until?: string; count?: number } = {};
  if (value.endType === "until" && value.until) {
    end.until = value.until.toString();
  } else if (value.endType === "count") {
    end.count = count;
  }

  if (value.freq === "WEEKLY") {
    return {
      freq: "WEEKLY",
      interval,
      byDay: normalizeByDay(value.byDay),
      ...end,
    };
  }

  if (value.freq === "MONTHLY") {
    return {
      freq: "MONTHLY",
      interval,
      byMonthDay: clampMonthDay(value.byMonthDay),
      ...end,
    };
  }

  if (value.freq === "YEARLY") {
    return {
      freq: "YEARLY",
      interval,
      ...end,
    };
  }

  return {
    freq: "DAILY",
    interval,
    ...end,
  };
}

export function getTaskRecurrenceIntervalLabel(
  freq: TaskRecurrenceFrequency,
  interval: number
): string {
  const labelMap: Record<TaskRecurrenceFrequency, [string, string]> = {
    DAILY: ["day", "days"],
    WEEKLY: ["week", "weeks"],
    MONTHLY: ["month", "months"],
    YEARLY: ["year", "years"],
  };
  return normalizePositiveInt(interval, 1) === 1
    ? labelMap[freq][0]
    : labelMap[freq][1];
}

export function getTaskRecurrenceDisplayText(
  value: TaskRecurrence | null
): string {
  if (!value) {
    return "Repeat";
  }

  const interval = normalizePositiveInt(value.interval, 1);
  const prefix = interval > 1 ? `Every ${interval} ` : "";

  switch (value.freq) {
    case "DAILY":
      return interval > 1 ? `${prefix}days` : "Daily";
    case "WEEKLY": {
      const days = normalizeByDay(value.byDay).join(", ");
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

export function toggleTaskRecurrenceDay(
  current: TaskRecurrenceDayCode[],
  day: TaskRecurrenceDayCode
): TaskRecurrenceDayCode[] {
  if (current.includes(day)) {
    return current.length === 1
      ? current
      : current.filter((value) => value !== day);
  }
  return [...current, day];
}

interface TaskRecurrenceSource {
  id: string;
  seriesMasterId: string | null;
  recurrence: TaskRecurrence | null | undefined;
}

/**
 * Resolve recurrence for editor contexts where recurring occurrences may omit
 * recurrence and only the series master stores it.
 */
export function resolveTaskRecurrenceForEditor(
  task: TaskRecurrenceSource,
  tasks: TaskRecurrenceSource[]
): TaskRecurrence | null {
  if (task.recurrence) {
    return task.recurrence;
  }

  if (!task.seriesMasterId) {
    return null;
  }

  const seriesMaster = tasks.find(
    (candidate) => candidate.id === task.seriesMasterId
  );
  return seriesMaster?.recurrence ?? null;
}

function normalizeRecurrenceForCompare(
  value: TaskRecurrence | null | undefined
): TaskRecurrence | null {
  if (!value) {
    return null;
  }

  const normalized = buildTaskRecurrence(
    getTaskRecurrenceEditorState(value, null)
  );

  if (normalized.freq === "WEEKLY") {
    return {
      ...normalized,
      byDay: [...normalized.byDay].sort(),
    };
  }

  return normalized;
}

export function taskRecurrenceEquals(
  a: TaskRecurrence | null | undefined,
  b: TaskRecurrence | null | undefined
): boolean {
  return (
    JSON.stringify(normalizeRecurrenceForCompare(a)) ===
    JSON.stringify(normalizeRecurrenceForCompare(b))
  );
}

export function haveTaskTagIdsChanged(
  previous: string[],
  next: string[]
): boolean {
  if (previous.length !== next.length) {
    return true;
  }

  const normalizedPrevious = [...previous].sort();
  const normalizedNext = [...next].sort();
  return normalizedPrevious.some(
    (value, index) => value !== normalizedNext[index]
  );
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeTemporalLike(
  value: { toString(): string } | string | null | undefined
): string | null {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.toString();
}

export interface TaskScopeComparableFields {
  title: string | null | undefined;
  description: string | null | undefined;
  durationMinutes: number | null | undefined;
  dueDate: { toString(): string } | string | null | undefined;
  startDate: { toString(): string } | string | null | undefined;
  startTime: { toString(): string } | string | null | undefined;
}

export function haveTaskCoreFieldsChanged(params: {
  previous: TaskScopeComparableFields;
  next: TaskScopeComparableFields;
}): boolean {
  const previousTitle = normalizeText(params.previous.title);
  const nextTitle = normalizeText(params.next.title);
  if (previousTitle !== nextTitle) {
    return true;
  }

  const previousDescription = normalizeText(params.previous.description);
  const nextDescription = normalizeText(params.next.description);
  if (previousDescription !== nextDescription) {
    return true;
  }

  if (params.previous.durationMinutes !== params.next.durationMinutes) {
    return true;
  }

  const previousStartDate = normalizeTemporalLike(params.previous.startDate);
  const nextStartDate = normalizeTemporalLike(params.next.startDate);
  if (previousStartDate !== nextStartDate) {
    return true;
  }

  const previousStartTime = normalizeTemporalLike(params.previous.startTime);
  const nextStartTime = normalizeTemporalLike(params.next.startTime);
  if (previousStartTime !== nextStartTime) {
    return true;
  }

  const previousDueDate = normalizeTemporalLike(params.previous.dueDate);
  const nextDueDate = normalizeTemporalLike(params.next.dueDate);
  return previousDueDate !== nextDueDate;
}

export type TaskUpdateScopeDecision =
  | { action: "apply"; scope: UpdateScope }
  | { action: "prompt"; defaultScope: UpdateScope };

export function getTaskUpdateScopeDecision(params: {
  isRecurring: boolean;
  isSeriesMaster: boolean;
  hasCoreFieldChanges: boolean;
  previousRecurrence: TaskRecurrence | null | undefined;
  nextRecurrence: TaskRecurrence | null | undefined;
  previousTagIds: string[];
  nextTagIds: string[];
}): TaskUpdateScopeDecision {
  if (!params.isRecurring) {
    return { action: "apply", scope: "this" };
  }

  const recurrenceChanged = !taskRecurrenceEquals(
    params.previousRecurrence,
    params.nextRecurrence
  );
  const tagsChanged = haveTaskTagIdsChanged(
    params.previousTagIds,
    params.nextTagIds
  );
  const hasChanges =
    params.hasCoreFieldChanges || recurrenceChanged || tagsChanged;

  if (!hasChanges) {
    return { action: "apply", scope: "this" };
  }

  if (params.isSeriesMaster) {
    return { action: "prompt", defaultScope: "this" };
  }

  return {
    action: "prompt",
    defaultScope: recurrenceChanged ? "following" : "this",
  };
}
