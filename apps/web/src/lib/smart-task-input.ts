"use client";

import { parse } from "chrono-node";
import { Temporal } from "temporal-polyfill";
import type { ParsedTaskInput } from "@/lib/task-input-parser";

/**
 * On-device natural-language task parsing through the browser Prompt API
 * (`LanguageModel`). Chrome answers it with Gemini Nano; the Electron app
 * answers it with Apple's Foundation Models (apps/electron/src/local-ai.ts).
 *
 * The model only copies phrases out of the input. Date math stays in
 * chrono-node, which small models get wrong.
 */

/** The subset of the Prompt API used here. */
interface PromptSession {
  clone: (options?: { signal?: AbortSignal }) => Promise<PromptSession>;
  destroy: () => void;
  prompt: (
    input: string,
    options?: { responseConstraint?: object; signal?: AbortSignal }
  ) => Promise<string>;
}
interface PromptAPI {
  availability: (options?: object) => Promise<string>;
  create: (options?: object) => Promise<PromptSession>;
}
declare global {
  var LanguageModel: PromptAPI | undefined;
}

/** The fields the model fills; they replace the same fields of the typed parse. */
export type SmartTaskInput = Pick<
  ParsedTaskInput,
  | "dueDate"
  | "durationMinutes"
  | "startDate"
  | "startTime"
  | "tagNames"
  | "title"
>;

interface Extraction {
  deadlineText?: string;
  durationText?: string;
  tags?: string[];
  title: string;
  whenText?: string;
}

const INSTRUCTIONS = `You turn a quick-add command into fields for a task.
Copy phrases verbatim from the input. Never invent or compute dates, times, or durations.
- title: the task itself, without when/deadline/duration words.
- whenText: words saying when it happens or will be worked on, e.g. "next tue 3pm", "tomorrow", "this weekend".
- deadlineText: only a deadline introduced by "by", "due", or "before", without that word, e.g. "friday", "nov 1".
- durationText: how long it takes, e.g. "for an hour", "45 min", "2h".
- tags: only tags clearly implied by the input.
Leave out any field the input doesn't mention.`;

const DEADLINE_WORD_PATTERN = /^(by|due|before)\s+/i;
const LANGUAGE = [{ languages: ["en"], type: "text" }];

/** JSON schema for the model's answer; tags are limited to the user's tags. */
function extractionSchema(tagNames: string[]) {
  return {
    properties: {
      title: { type: "string" },
      whenText: { type: "string" },
      deadlineText: { type: "string" },
      durationText: { type: "string" },
      ...(tagNames.length > 0
        ? { tags: { items: { enum: tagNames, type: "string" }, type: "array" } }
        : {}),
    },
    required: ["title"],
    type: "object",
  };
}

let baseSession: Promise<PromptSession | null> | undefined;

/**
 * A session holding the instructions, cloned per request so the prefix is
 * processed once. Resolves to null when no model is ready; this never starts
 * a model download.
 */
function getBaseSession() {
  baseSession ??= (async () => {
    const api = globalThis.LanguageModel;
    if (!api) {
      return null;
    }
    const options = { expectedInputs: LANGUAGE, expectedOutputs: LANGUAGE };
    if ((await api.availability(options)) !== "available") {
      return null;
    }
    return api.create({
      ...options,
      initialPrompts: [{ content: INSTRUCTIONS, role: "system" }],
    });
  })().catch(() => null);
  return baseSession;
}

/** True when an on-device model can answer without a download. */
export async function isSmartTaskInputAvailable() {
  return (await getBaseSession()) !== null;
}

const DURATION_PATTERN =
  /(\d+(?:\.\d+)?|an?|half an?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/gi;

/** Minutes in a duration phrase such as "for an hour", "1h 30m", "45 min". */
export function parseDurationText(text: string): number | null {
  let minutes = 0;
  for (const [, amount = "", unit = ""] of text.matchAll(DURATION_PATTERN)) {
    let value = Number.parseFloat(amount);
    if (Number.isNaN(value)) {
      value = amount.toLowerCase().startsWith("half") ? 0.5 : 1;
    }
    minutes += unit.toLowerCase().startsWith("h") ? value * 60 : value;
  }
  return minutes > 0 ? Math.round(minutes) : null;
}

function toPlainDate(date: Date) {
  return Temporal.PlainDate.from({
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  });
}

/** Resolve a date phrase with chrono-node; the time only when one was said. */
export function resolveWhen(text: string, referenceDate: Date) {
  const [result] = parse(text, referenceDate, { forwardDate: true });
  if (!result) {
    return null;
  }
  const { start } = result;
  const date = toPlainDate(start.date());
  if (!start.isCertain("hour")) {
    return { date, time: null };
  }
  let hour = start.get("hour") ?? 0;
  // "at 4" means the afternoon for a task, not 4am.
  if (!start.isCertain("meridiem") && hour >= 1 && hour <= 7) {
    hour += 12;
  }
  const time = Temporal.PlainTime.from({
    hour,
    minute: start.get("minute") ?? 0,
  });
  return { date, time };
}

/** The phrase if it really occurs in the input; models echo prompt examples. */
function verbatim(phrase: string | undefined, input: string) {
  const trimmed = phrase?.trim();
  return trimmed && input.toLowerCase().includes(trimmed.toLowerCase())
    ? trimmed
    : undefined;
}

/**
 * Widen a phrase to the whole date expression chrono finds around it, since
 * the model sometimes clips one ("in 2 days" of "in 2 days at 4").
 */
function widen({
  input,
  phrase,
  referenceDate,
}: {
  input: string;
  phrase: string;
  referenceDate: Date;
}) {
  const lower = phrase.toLowerCase();
  const match = parse(input, referenceDate, { forwardDate: true }).find(
    (result) => result.text.toLowerCase().includes(lower)
  );
  return match?.text ?? phrase;
}

/** Keep only phrases from the input and sort out start vs deadline. */
export function checkPhrases({
  extraction,
  input,
  referenceDate,
}: {
  extraction: Extraction;
  input: string;
  referenceDate: Date;
}) {
  let when = verbatim(extraction.whenText, input);
  let deadline = verbatim(extraction.deadlineText, input);
  // "before end of month" is a deadline even when the model calls it a start.
  if (when && DEADLINE_WORD_PATTERN.test(when)) {
    deadline ??= when.replace(DEADLINE_WORD_PATTERN, "");
    when = undefined;
  }
  // Small models also repeat a deadline as the start ("due nov 1").
  if (when && when === deadline) {
    when = undefined;
  }
  return {
    deadline,
    duration: verbatim(extraction.durationText, input),
    when: when && widen({ input, phrase: when, referenceDate }),
  };
}

/**
 * Parse free-form task input with the on-device model. Resolves to null when
 * no model is available or the model fails.
 */
export async function smartParseTaskInput(
  input: string,
  {
    referenceDate = new Date(),
    signal,
    tagNames,
  }: { referenceDate?: Date; signal?: AbortSignal; tagNames: string[] }
): Promise<SmartTaskInput | null> {
  const base = await getBaseSession();
  if (!base) {
    return null;
  }
  const session = await base.clone({ signal });
  try {
    const raw = await session.prompt(input, {
      responseConstraint: extractionSchema(tagNames),
      signal,
    });
    const extraction = JSON.parse(raw) as Extraction;
    const phrases = checkPhrases({ extraction, input, referenceDate });
    const when = phrases.when ? resolveWhen(phrases.when, referenceDate) : null;
    const due = phrases.deadline
      ? resolveWhen(phrases.deadline, referenceDate)
      : null;
    return {
      dueDate: due?.date ?? null,
      durationMinutes: phrases.duration
        ? parseDurationText(phrases.duration)
        : null,
      startDate: when?.date ?? null,
      startTime: when?.time ?? null,
      tagNames: (extraction.tags ?? []).filter((tag) => tagNames.includes(tag)),
      title: extraction.title.trim() || input,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    console.warn("On-device task parsing failed", error);
    return null;
  } finally {
    session.destroy();
  }
}
