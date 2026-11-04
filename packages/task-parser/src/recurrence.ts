type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** Mirrors `TaskRecurrence` in @kompose/db (packages/db/src/schema/task.ts). */
export type TaskRecurrence = (
  | { freq: "DAILY"; interval: number }
  | { byDay: Weekday[]; freq: "WEEKLY"; interval: number }
  | { byMonthDay: number; freq: "MONTHLY"; interval: number }
  | { freq: "YEARLY"; interval: number }
) & { count?: number; until?: string };
