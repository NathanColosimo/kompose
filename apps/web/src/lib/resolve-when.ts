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
  const result = await parse(trimmed, context(now));
  const [first] = result.occurrences;
  if (!first) {
    return null;
  }
  // gpu-time gives local times with an offset; the offset is dropped here.
  const start = Temporal.PlainDateTime.from(first.start);
  if (first.allDay) {
    return { date: start.toPlainDate(), time: null };
  }
  let time = start.toPlainTime();
  // "at 4" means the afternoon for a task, not 4am.
  const ambiguous = result.diagnostics.some(
    (diagnostic) => diagnostic.code === "ambiguous-meridiem"
  );
  if (ambiguous && time.hour >= 1 && time.hour <= 7) {
    time = time.add({ hours: 12 });
  }
  return { date: start.toPlainDate(), time };
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
