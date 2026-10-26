/**
 * Messages between the main thread and worker.ts. Temporal values don't
 * survive structured cloning, so dates and times cross as ISO strings.
 */
import { Temporal } from "temporal-polyfill";
import type { ParsedTask, TagOption } from "./parser";

export type WorkerRequest =
  | { id: number; type: "load"; url: string }
  | {
      id: number;
      /** ZonedDateTime string ("2026-10-23T10:00:00-04:00[America/New_York]"). */
      now: string;
      tags: TagOption[];
      text: string;
      type: "parse";
    };

export type WireTask = Omit<
  ParsedTask,
  "dueDate" | "startDate" | "startTime"
> & {
  dueDate: string | null;
  startDate: string | null;
  startTime: string | null;
};

export type WorkerResponse =
  | { id: number; type: "ready" }
  | { id: number; result: WireTask; type: "parsed" }
  | { id: number; message: string; type: "error" };

export function toWire(task: ParsedTask): WireTask {
  return {
    ...task,
    dueDate: task.dueDate?.toString() ?? null,
    startDate: task.startDate?.toString() ?? null,
    startTime: task.startTime?.toString() ?? null,
  };
}

export function fromWire(task: WireTask): ParsedTask {
  return {
    ...task,
    dueDate: task.dueDate ? Temporal.PlainDate.from(task.dueDate) : null,
    startDate: task.startDate ? Temporal.PlainDate.from(task.startDate) : null,
    startTime: task.startTime ? Temporal.PlainTime.from(task.startTime) : null,
  };
}
