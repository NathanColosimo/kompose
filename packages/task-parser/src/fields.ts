import { Temporal } from "temporal-polyfill";
import { parseDuration } from "./duration";
import { type TaskRecurrence, toTaskRecurrence } from "./recurrence";
import type { Label, Span } from "./spans";
import { resolveWhen } from "./when";

/** A task built from labelled spans. */
export interface TaskFields {
  description: string | null;
  dueDate: Temporal.PlainDate | null;
  durationMinutes: number | null;
  links: string[];
  recurrence: TaskRecurrence | null;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
  tagNames: string[];
  title: string;
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?)]+$/;

/** What may sit between two pieces of one field and stay in it. */
const JOINER_PATTERN =
  /^(\s*[,;:.&+/\u2013\u2014-]+\s*|\s+(and|then|&|\+)\s+)$/i;
/**
 * Punctuation and linking words left dangling where a date or duration was
 * cut out ("stretch for [10 minutes]"). "in"/"on" stay: they're often part
 * of the verb ("check in", "follow up on").
 */
const TRAILING_JOINER_PATTERN =
  /(?:[\s,;:&+/\u2013\u2014-]|\s(?:for|at|by|from|until|till|starting|due|every|before|and|or)\b)+$/i;

const CLOCK_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
/** A time of day with no date: "4pm", "930am", "half nine", "evening". */
const CLOCK_ONLY_PATTERN = new RegExp(
  `^(?:by|at|before|until|till|around|about|@)?\\s*(?:\\d{1,2}(?::?\\d{2})?\\s*(?:[ap]\\.?m\\.?)?|(?:half|quarter)(?:\\s+(?:past|to))?\\s+(?:\\d{1,2}|${CLOCK_WORDS})|(?:${CLOCK_WORDS})(?:[\\s-]+(?:thirty|fifteen|forty[\\s-]five|ten|twenty|o'clock))?|noon|midday|midnight|eod|cob|end of (?:the )?day|close of business|(?:in the )?(?:morning|afternoon|evening|night)|(?:lunch|dinner)(?:time)?)$`,
  "i"
);
const CORRECTION_PATTERN =
  /\b(?:actually|make (?:it|that)|no wait|instead|i mean|scratch that|change (?:it|that) to)\b/i;
const BARE_CLOCK_PATTERN = /^(?:at |around |about )?\d{1,2}(?::\d{2})?$/i;
const MORNING_PATTERN = /\b(?:morning|a\.?m)\b/i;
const EVENING_PATTERN = /\b(?:tonight|evening|night|afternoon|p\.?m)\b/i;

/**
 * The text of every `label` span. Neighbouring pieces keep what separated
 * them in the input when it's only punctuation or "and" ("notes; more
 * notes"), so a field reads the same however finely it was split.
 */
function textOf(spans: Span[], label: Label, text?: string) {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let result = "";
  let previous: Span | null = null;
  for (const span of ordered) {
    if (span.label === label) {
      const gap =
        previous?.label === label && text !== undefined
          ? text.slice(previous.end, span.start)
          : "";
      result += !result || JOINER_PATTERN.test(gap) ? gap : " ";
      result += span.text;
    }
    previous = span;
  }
  return result.trim().replace(TRAILING_JOINER_PATTERN, "");
}

/**
 * The pieces of a date split over several `label` spans: the first dated
 * one ("monday morning", not a later "november 4" in the notes) and the
 * last clock-only one ("tomorrow … no, half nine" → half nine).
 */
function whenPieces(spans: Span[], label: Label) {
  const ordered = spans
    .filter((span) => span.label === label)
    .sort((a, b) => a.start - b.start);
  const pieces = ordered.map((span) => span.text.trim());
  const days = pieces.filter((piece) => !CLOCK_ONLY_PATTERN.test(piece));
  // "thursday the 29th, actually make that wednesday": the last one wins.
  const corrected =
    days.length > 1 &&
    spans.some(
      (span) =>
        span.label === "F" &&
        CORRECTION_PATTERN.test(span.text) &&
        span.start > (ordered[0]?.start ?? 0)
    );
  const day = (corrected ? days.at(-1) : days[0]) ?? null;
  const clock =
    pieces.findLast((piece) => CLOCK_ONLY_PATTERN.test(piece)) ?? null;
  return { clock, day, text: [day, clock].filter(Boolean).join(" ") };
}

/** "7:30" after "tomorrow morning" is 7:30am; "8" after "tonight" is 8pm. */
function withMeridiemOf(day: string, clock: string) {
  if (!BARE_CLOCK_PATTERN.test(clock)) {
    return clock;
  }
  if (MORNING_PATTERN.test(day)) {
    return `${clock}am`;
  }
  return EVENING_PATTERN.test(day) ? `${clock}pm` : clock;
}

/** A day piece read on its own, with the clock piece's time when there is one. */
async function resolvePieces(
  { clock, day, text }: ReturnType<typeof whenPieces>,
  now: Temporal.ZonedDateTime
) {
  if (!(day && clock)) {
    return text ? resolveWhen(text, { now }) : null;
  }
  const date = await resolveWhen(day, { now });
  if (!date) {
    return resolveWhen(text, { now });
  }
  const time = await resolveWhen(withMeridiemOf(day, clock), {
    now: date.date.toZonedDateTime({ timeZone: now.timeZoneId }),
  });
  return time?.time ? { ...date, end: time.end, time: time.time } : date;
}

function sentence(text: string) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function toLink(text: string) {
  const trimmed = text.replace(TRAILING_PUNCTUATION_PATTERN, "");
  return SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Resolve labelled spans into task fields. Dates resolve against `now`;
 * `tagNames` are the tags already chosen for the input.
 */
export async function resolveFields({
  now = Temporal.Now.zonedDateTimeISO(),
  spans,
  tagNames,
  text,
}: {
  now?: Temporal.ZonedDateTime;
  spans: Span[];
  tagNames: string[];
  /** The input, so split fields keep their punctuation. */
  text?: string;
}): Promise<TaskFields> {
  const startPieces = whenPieces(spans, "S");
  const duePieces = whenPieces(spans, "U");
  const startText = startPieces.text;
  const dueText = duePieces.text;
  const repeatText = textOf(spans, "R");

  const start = await resolvePieces(startPieces, now);
  const repeat = repeatText
    ? await resolveRepeat({ dueText, now, repeatText, startText })
    : null;
  const anchor = start ?? repeat;
  // "start nov 5 at 1:15, due 4pm": a deadline with only a clock time is on
  // the start's day (or the next one after the start).
  const dueFrom =
    anchor && CLOCK_ONLY_PATTERN.test(dueText)
      ? anchor.date.toZonedDateTime({
          plainTime: anchor.time ?? undefined,
          timeZone: now.timeZoneId,
        })
      : now;
  const due = await resolvePieces(duePieces, dueFrom);

  const startDate = repeat?.date ?? start?.date ?? null;
  return {
    description: sentence(textOf(spans, "D", text)) || null,
    dueDate: due?.date ?? null,
    durationMinutes: parseDuration(textOf(spans, "M")) ?? rangeMinutes(start),
    links: spans
      .filter((span) => span.label === "L")
      .map((span) => toLink(span.text)),
    recurrence:
      repeat?.rrule && startDate
        ? toTaskRecurrence(repeat.rrule, startDate, now.timeZoneId)
        : null,
    startDate,
    startTime: repeat?.time ?? start?.time ?? null,
    tagNames,
    title: sentence(textOf(spans, "T", text)),
  };
}

const EVERY_PATTERN = /\b(every|each)\b/i;
const ENDING_PATTERN =
  /\s+(?:repeat(?:ing)?\s+)?(?:thru|through|until|till|ending(?:\s+on)?|up to)\s+(.+)$/i;
const LAST_WEEKDAY_PATTERN = /\blast (?:week|business |work(?:ing)? )day\b/i;
const MONTH_WORDS_PATTERN = /^.*\bmonth\b/i;

/**
 * "the last weekday of every month" has no place in the task schema, so it
 * resolves to its next date (and time) without a repeat.
 */
async function lastWeekdayRepeat(text: string, now: Temporal.ZonedDateTime) {
  const today = now.toPlainDate();
  let date = lastWeekdayOf(today);
  if (Temporal.PlainDate.compare(date, today) < 0) {
    date = lastWeekdayOf(today.add({ months: 1 }));
  }
  const clock = text.replace(MONTH_WORDS_PATTERN, "").trim();
  const time = clock
    ? ((await resolveWhen(clock, { now }))?.time ?? null)
    : null;
  return { date, end: null, rrule: null, time };
}

function lastWeekdayOf(day: Temporal.PlainDate) {
  let last = day.with({ day: day.daysInMonth });
  while (last.dayOfWeek > 5) {
    last = last.subtract({ days: 1 });
  }
  return last;
}

/** Repeat words gpu-time doesn't know, as phrases it does. */
const REPEAT_SYNONYMS: [RegExp, string][] = [
  [/\bnightly\b/i, "every night"],
  [/\bonce an? (day|week|month|year)\b/i, "every $1"],
  [/\bquarterly\b/i, "every 3 months"],
  [/\bsemi-?annually\b/i, "every 6 months"],
  [/\bfortnightly\b/i, "every 2 weeks"],
  [/\bm\/?w\/?f\b/i, "mon wed fri"],
  [/\bt\/?th\b/i, "tue thu"],
  [/\bm-f\b/i, "weekdays"],
  // Clinical shorthand: "q2 weeks", "q3d".
  [/\bq(\d+)\s*(day|week|month)s?\b/i, "every $1 $2s"],
  [/\bq(\d+)d\b/i, "every $1 days"],
  [/\bea\.?\s+mo\b/i, "each month"],
  [/\bea\.?\s+wk\b/i, "each week"],
];

function normalizeRepeat(text: string) {
  let result = text;
  for (const [pattern, replacement] of REPEAT_SYNONYMS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Minutes in an explicit time range ("2-2:30"). */
function rangeMinutes(when: Awaited<ReturnType<typeof resolveWhen>>) {
  if (!(when?.end && when.time)) {
    return null;
  }
  const minutes = when.date
    .toPlainDateTime(when.time)
    .until(when.end, { largestUnit: "minutes" }).minutes;
  return minutes > 0 ? minutes : null;
}

/**
 * A repeat with its anchor: "every monday" starting "next week", or "every
 * month" by "the 1st". Falls back to the repeat phrase alone.
 */
async function resolveRepeat({
  dueText,
  now,
  repeatText,
  startText,
}: {
  dueText: string;
  now: Temporal.ZonedDateTime;
  repeatText: string;
  startText: string;
}) {
  const normalized = normalizeRepeat(repeatText);
  if (LAST_WEEKDAY_PATTERN.test(normalized)) {
    return lastWeekdayRepeat(normalized, now);
  }
  // gpu-time wants the end last: "every sun starting oct 25 until dec 20".
  const ending = ENDING_PATTERN.exec(normalized);
  const base = ending ? normalized.slice(0, ending.index) : normalized;
  const until = ending ? ` until ${ending[1]}` : "";
  const phrases = [base];
  // "mon wed fri at 6am" only repeats for gpu-time with "every".
  if (!EVERY_PATTERN.test(base)) {
    phrases.push(`every ${base}`);
  }
  const candidates = phrases.flatMap((phrase) =>
    [
      startText && `${phrase} starting ${startText}${until}`,
      dueText && `${phrase} on ${dueText}${until}`,
      `${phrase}${until}`,
      until && phrase,
    ].filter(Boolean)
  );
  // The first reading the task schema can hold wins; otherwise keep any
  // repeating reading for its first date.
  let fallback: Awaited<ReturnType<typeof resolveWhen>> = null;
  for (const candidate of candidates) {
    // Sequential on purpose: the first reading that fits wins.
    // biome-ignore lint/performance/noAwaitInLoops: see above
    const resolved = await resolveWhen(candidate, { now });
    if (!resolved?.rrule) {
      continue;
    }
    if (toTaskRecurrence(resolved.rrule, resolved.date, now.timeZoneId)) {
      return resolved;
    }
    fallback ??= resolved;
  }
  return fallback;
}
