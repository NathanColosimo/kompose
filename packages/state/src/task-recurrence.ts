import type {
  TaskRecurrence,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";

export const TASK_RECURRENCE_DAYS = [
  { label: "Mon", shortLabel: "M", value: "MO" },
  { label: "Tue", shortLabel: "T", value: "TU" },
  { label: "Wed", shortLabel: "W", value: "WE" },
  { label: "Thu", shortLabel: "T", value: "TH" },
  { label: "Fri", shortLabel: "F", value: "FR" },
  { label: "Sat", shortLabel: "S", value: "SA" },
  { label: "Sun", shortLabel: "S", value: "SU" },
] as const;

export type TaskRecurrenceDayCode =
  (typeof TASK_RECURRENCE_DAYS)[number]["value"];
export type TaskRecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type TaskRecurrenceEndType = "never" | "until" | "count";

export interface TaskRecurrenceEditorState {
  byDay: TaskRecurrenceDayCode[];
  byMonthDay: number;
  count: number;
  endType: TaskRecurrenceEndType;
  freq: TaskRecurrenceFrequency;
  interval: number;
  until: Temporal.PlainDate | null;
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
  let endType: TaskRecurrenceEndType;
  if (value?.until) {
    endType = "until";
  } else if (value?.count) {
    endType = "count";
  } else {
    endType = "never";
  }

  return {
    byDay:
      value?.freq === "WEEKLY"
        ? normalizeByDay(value.byDay)
        : defaultByDay(referenceDate),
    byMonthDay:
      value?.freq === "MONTHLY"
        ? clampMonthDay(value.byMonthDay)
        : clampMonthDay(referenceDate?.day ?? 1),
    count: normalizePositiveInt(value?.count, 10),
    endType,
    freq: (value?.freq ?? "WEEKLY") as TaskRecurrenceFrequency,
    interval: normalizePositiveInt(value?.interval, 1),
    until: value?.until ? Temporal.PlainDate.from(value.until) : null,
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
      byDay: normalizeByDay(value.byDay),
      freq: "WEEKLY",
      interval,
      ...end,
    };
  }

  if (value.freq === "MONTHLY") {
    return {
      byMonthDay: clampMonthDay(value.byMonthDay),
      freq: "MONTHLY",
      interval,
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
    MONTHLY: ["month", "months"],
    WEEKLY: ["week", "weeks"],
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
      const days = normalizeByDay(value.byDay)
        .map(
          (code) =>
            TASK_RECURRENCE_DAYS.find((day) => day.value === code)?.label
        )
        .join(", ");
      return interval > 1 ? `${prefix}weeks on ${days}` : `Weekly on ${days}`;
    }
    case "MONTHLY":
      return `${interval > 1 ? `${prefix}months` : "Monthly"} on day ${value.byMonthDay}`;
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
  recurrence: TaskRecurrence | null | undefined;
  seriesMasterId: string | null;
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
  value: { toString: () => string } | string | null | undefined
): string | null {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.toString();
}

export interface TaskScopeComparableFields {
  description: string | null | undefined;
  dueDate: { toString: () => string } | string | null | undefined;
  durationMinutes: number | null | undefined;
  startDate: { toString: () => string } | string | null | undefined;
  startTime: { toString: () => string } | string | null | undefined;
  title: string | null | undefined;
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
  /**
   * The task has a date, so later occurrences follow it. An occurrence
   * moved to the inbox has none: its edits apply to it alone, no question.
   */
  hasFollowing?: boolean;
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

  // A new pattern (or "Repeat: None") can only apply from this occurrence on:
  // one occurrence can't repeat differently from its series. So there's no
  // choice to offer.
  if (recurrenceChanged) {
    return { action: "apply", scope: "following" };
  }

  if (params.hasFollowing === false) {
    return { action: "apply", scope: "this" };
  }

  return { action: "prompt", defaultScope: "this" };
}

/**
 * The error for a Mark done (or not done) that failed while the editor held
 * open on it: what failed, and that the edits are still in the editor.
 */
export function markStatusFailureMessage(
  status: TaskSelectDecoded["status"]
): string {
  return status === "done"
    ? "Couldn't mark the task done. Your changes are still here."
    : "Couldn't reopen the task. Your changes are still here.";
}

const SPACES = / /g;

/**
 * The blocking note, naming both dates so it says what to fix: "The repeat
 * ends Nov 13, before the task starts on Nov 14."
 */
function repeatEndsBeforeStartText(
  until: string,
  startDate: Temporal.PlainDate
): string {
  // A non-breaking space keeps "Nov 14" together when the note wraps.
  const day = (date: Temporal.PlainDate) =>
    date
      .toLocaleString(undefined, { day: "numeric", month: "short" })
      .replace(SPACES, "\u00A0");
  return `The repeat ends ${day(Temporal.PlainDate.from(until))}, before the task starts on ${day(startDate)}.`;
}

/** A repeat whose end comes before the task's start has no occurrences. */
export function repeatEndsBeforeStart(
  recurrence: TaskRecurrence | null | undefined,
  startDate: Temporal.PlainDate | null | undefined
): boolean {
  return Boolean(
    recurrence?.until && startDate && recurrence.until < startDate.toString()
  );
}

/**
 * Whether the editor's repeat stops it saving: only a pattern the edit sets
 * (a new task's, or a changed one) that ends before the start. An unchanged
 * series pattern isn't sent, so moving its last occurrence past the end
 * ("Daily until Nov 14", Nov 14 moved to Nov 16) still saves.
 */
export function repeatBlocksSave(params: {
  next: TaskRecurrence | null | undefined;
  previous: TaskRecurrence | null;
  startDate: Temporal.PlainDate | null | undefined;
}): boolean {
  if (taskRecurrenceEquals(params.previous, params.next ?? null)) {
    return false;
  }
  // A repeat counts from the start date, so it needs one.
  if (params.next && !params.startDate) {
    return true;
  }
  return repeatEndsBeforeStart(params.next, params.startDate);
}

const PICK_START_TO_REPEAT = "Pick a start date to repeat this task.";

/**
 * What the editor says under Repeat: why it can't save ("ends before the
 * task starts", blocking), else what a change to a recurring task's
 * pattern will do (it applies from this occurrence on, with no scope
 * question). Null when there's nothing to say.
 */
export function repeatNote(params: {
  isRecurring: boolean;
  next: TaskRecurrence | null | undefined;
  previous: TaskRecurrence | null;
  startDate: Temporal.PlainDate | null | undefined;
  /**
   * An occurrence moved to the inbox (no date): a repeat change takes it
   * out of its series, or makes it a series of its own.
   */
  undatedMember?: boolean;
}): { blocking: boolean; text: string } | null {
  if (repeatBlocksSave(params)) {
    return {
      blocking: true,
      text:
        params.next?.until && params.startDate
          ? repeatEndsBeforeStartText(params.next.until, params.startDate)
          : PICK_START_TO_REPEAT,
    };
  }
  const text = params.undatedMember
    ? undatedRepeatNote(params)
    : repeatChangeNote(params);
  return text ? { blocking: false, text } : null;
}

function undatedRepeatNote(params: {
  next: TaskRecurrence | null | undefined;
  previous: TaskRecurrence | null;
}): string | null {
  if (taskRecurrenceEquals(params.previous, params.next ?? null)) {
    return null;
  }
  return params.next
    ? "Makes this task a series of its own."
    : "Takes this task out of its series.";
}

/**
 * What a repeat change on a recurring task will do, shown before Save: it
 * applies from the edited occurrence on, with no scope question. Null when
 * the task doesn't repeat or the pattern is unchanged.
 */
export function repeatChangeNote(params: {
  isRecurring: boolean;
  next: TaskRecurrence | null | undefined;
  previous: TaskRecurrence | null;
}): string | null {
  if (
    !params.isRecurring ||
    taskRecurrenceEquals(params.previous, params.next ?? null)
  ) {
    return null;
  }
  return params.next
    ? "Applies to this and later occurrences."
    : "Stops repeating here. Later ones you haven't edited are removed.";
}
