import { Temporal } from "temporal-polyfill";
import { isClockOnly } from "./datetime";
import { parseDuration } from "./duration";
import type { TaskRecurrence } from "./recurrence";
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

/** "to" left over from "remind me to …" when the filler span stops early. */
const LEADING_TO_PATTERN = /^to\s+(?!do\b)(?=\S+\s+\S)/i;
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
  const days = pieces.filter((piece) => !isClockOnly(piece));
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
  const clock = pieces.findLast((piece) => isClockOnly(piece)) ?? null;
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
function resolvePieces(
  { clock, day, text }: ReturnType<typeof whenPieces>,
  now: Temporal.ZonedDateTime
) {
  if (!(day && clock)) {
    return text ? resolveWhen(text, { now }) : null;
  }
  const date = resolveWhen(day, { now });
  // "thanksgiving" + "3pm ET": read together, so the zone can move the day.
  if (!date?.time) {
    return resolveWhen(`${day} ${withMeridiemOf(day, clock)}`, { now }) ?? date;
  }
  // "tomorrow at 3 … no, 4": the later clock replaces the day's.
  const time = resolveWhen(withMeridiemOf(day, clock), {
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
export function resolveFields({
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
}): TaskFields {
  const startPieces = whenPieces(spans, "S");
  const duePieces = whenPieces(spans, "U");
  const startText = startPieces.text;
  const dueText = duePieces.text;
  const repeatText = textOf(spans, "R");

  const repeat = repeatText
    ? resolveRepeat({
        dueText,
        now,
        repeatText,
        startText,
        until: endsRepeat(spans, text),
      })
    : weekdayList(startText, now);
  const start = repeat && !repeatText ? null : resolvePieces(startPieces, now);
  const anchor = start ?? repeat;
  // "start nov 5 at 1:15, due 4pm": a deadline with only a clock time is on
  // the start's day (or the next one after the start).
  const dueFrom =
    anchor && isClockOnly(dueText)
      ? anchor.date.toZonedDateTime({
          plainTime: anchor.time ?? undefined,
          timeZone: now.timeZoneId,
        })
      : now;
  const due = resolvePieces(duePieces, dueFrom);

  const startDate = repeat?.date ?? start?.date ?? null;
  return {
    description: sentence(textOf(spans, "D", text)) || null,
    dueDate: due?.date ?? null,
    durationMinutes: parseDuration(textOf(spans, "M")) ?? rangeMinutes(start),
    links: spans
      .filter((span) => span.label === "L")
      .map((span) => toLink(span.text)),
    recurrence: repeat?.recurrence ?? null,
    startDate,
    startTime: repeat?.time ?? start?.time ?? null,
    tagNames,
    title: sentence(textOf(spans, "T", text).replace(LEADING_TO_PATTERN, "")),
  };
}

const ALTERNATIVE_PATTERN = /\b(?:or|either)\b/i;

/**
 * A start that lists several weekdays ("gym mon wed fri at 6am") repeats
 * weekly on them, unless they're alternatives ("mon or tue").
 */
function weekdayList(startText: string, now: Temporal.ZonedDateTime) {
  if (!startText || ALTERNATIVE_PATTERN.test(startText)) {
    return null;
  }
  const resolved = resolveWhen(startText, { now, repeating: true });
  const recurrence = resolved?.recurrence;
  return recurrence?.freq === "WEEKLY" && recurrence.byDay.length >= 2
    ? resolved
    : null;
}

const UNTIL_GAP_PATTERN =
  /\b(?:until|till|til|thru|through|ending(?: on)?)\s*$/i;

/** Whether the first due span follows "until"/"through" (a repeat's end). */
function endsRepeat(spans: Span[], text?: string) {
  const due = spans.find((span) => span.label === "U");
  return (
    due !== undefined &&
    text !== undefined &&
    UNTIL_GAP_PATTERN.test(text.slice(Math.max(0, due.start - 20), due.start))
  );
}

/** Minutes in an explicit time range ("2-2:30"). */
function rangeMinutes(when: ReturnType<typeof resolveWhen>) {
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
function resolveRepeat({
  dueText,
  now,
  repeatText,
  startText,
  until,
}: {
  dueText: string;
  now: Temporal.ZonedDateTime;
  repeatText: string;
  startText: string;
  /** The due span is the repeat's end ("every tue until [dec]"). */
  until: boolean;
}) {
  const base = until && dueText ? `${repeatText} until ${dueText}` : repeatText;
  const candidates = [
    startText && `${base} starting ${startText}`,
    !until && dueText && !isClockOnly(dueText) && `${base} on ${dueText}`,
    base,
  ].filter(Boolean) as string[];
  // The fullest reading that resolves wins.
  for (const candidate of candidates) {
    const resolved = resolveWhen(candidate, { now, repeating: true });
    if (resolved) {
      return resolved;
    }
  }
  return null;
}
