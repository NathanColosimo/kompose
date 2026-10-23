import { Temporal } from "temporal-polyfill";

/**
 * Date and time phrases resolve through gpu-time, a small neural parser
 * (~46 KB brotli) that runs on the CPU in about a millisecond. It is loaded
 * on first use, so only the task input pays for it.
 */
const loadParser = () => import("gpu-time");

export interface ResolvedWhen {
  date: Temporal.PlainDate;
  /** Null when the phrase named a day but no time ("tomorrow"). */
  time: Temporal.PlainTime | null;
}

const MINUTES_PATTERN = /^:\d{2}/;

// Day parts land on times a task would plausibly start.
const DAY_PARTS = {
  afternoon: ["13:00", "17:00"],
  evening: ["18:00", "21:00"],
  morning: ["09:00", "12:00"],
  night: ["20:00", "23:00"],
} satisfies Record<string, [string, string]>;

function context(now: Temporal.ZonedDateTime) {
  return {
    dayParts: DAY_PARTS,
    reference: now.toString({ timeZoneName: "never" }),
    timeZone: now.timeZoneId,
  };
}

/**
 * Resolve a date phrase ("next tue 3pm", "the 15th", "every weekday at 9")
 * to its first occurrence. A recurrence resolves to its next date.
 */
export async function resolveWhen(
  text: string,
  {
    now = Temporal.Now.zonedDateTimeISO(),
  }: { now?: Temporal.ZonedDateTime } = {}
): Promise<ResolvedWhen | null> {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const { parse } = await loadParser();
  let result = await parse(trimmed, context(now));
  // "at 4" means the afternoon for a task, not 4am. Saying so and parsing
  // again keeps gpu-time's choice of day right ("at 4" at 10am is today).
  const afternoon = afternoonReading(trimmed, result.diagnostics);
  if (afternoon) {
    result = await parse(afternoon, context(now));
  }
  const [first] = result.occurrences;
  if (!first) {
    return null;
  }
  // gpu-time gives local times with an offset; the offset is dropped here.
  const start = Temporal.PlainDateTime.from(first.start);
  return {
    date: start.toPlainDate(),
    time: first.allDay ? null : start.toPlainTime(),
  };
}

/**
 * `text` with "pm" after each hour from 1 to 7 that gpu-time found without
 * am/pm, or null when there is none.
 */
function afternoonReading(
  text: string,
  diagnostics: { code: string; end: number; start: number }[]
) {
  let result = text;
  // Right to left, so earlier offsets stay valid.
  const ambiguous = diagnostics
    .filter((diagnostic) => diagnostic.code === "ambiguous-meridiem")
    .toSorted((a, b) => b.end - a.end);
  for (const { end: hourEnd, start } of ambiguous) {
    const hour = Number.parseInt(text.slice(start, hourEnd), 10);
    // The flagged range is only the hour of "4:30".
    const end =
      hourEnd + (MINUTES_PATTERN.exec(text.slice(hourEnd))?.[0].length ?? 0);
    if (hour >= 1 && hour <= 7) {
      result = `${result.slice(0, end)}pm${result.slice(end)}`;
    }
  }
  return result === text ? null : result;
}

/** The text of every date expression gpu-time finds in `text`. */
export async function findWhenPhrases(
  text: string,
  {
    now = Temporal.Now.zonedDateTimeISO(),
  }: { now?: Temporal.ZonedDateTime } = {}
): Promise<string[]> {
  const { parse } = await loadParser();
  const result = await parse(text, context(now));
  return result.spans.map((span) => span.text);
}
