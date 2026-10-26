import { Temporal } from "temporal-polyfill";
import { holidayDate } from "./holidays";
import {
  normalizeWhen,
  offsetFrom,
  quarterEnd,
  withoutTrailingWords,
} from "./normalize-when";

/**
 * Date and time phrases resolve through gpu-time, a small neural parser
 * (~46 KB brotli) that runs on the CPU in about a millisecond. It is loaded
 * on first use, so only callers that parse pay for it.
 */
const loadParser = () => import("gpu-time");

export interface ResolvedWhen {
  date: Temporal.PlainDate;
  /** End of an explicit time range ("2-2:30pm"), for a default duration. */
  end: Temporal.PlainDateTime | null;
  /** The RFC 5545 rule when the phrase repeats ("every weekday at 9"). */
  rrule: string | null;
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
  const named =
    holidayDate(trimmed, now.toPlainDate()) ??
    quarterEnd(trimmed, now.toPlainDate());
  if (named) {
    return { date: named, end: null, rrule: null, time: null };
  }
  // "a week from tuesday": resolve "tuesday", then move it.
  const offset = offsetFrom(trimmed);
  if (offset) {
    const anchor = await resolveWhen(offset.anchor, { now });
    return (
      anchor && {
        ...anchor,
        date: anchor.date.add({ days: offset.days }),
        rrule: null,
      }
    );
  }
  const zone = TIME_ZONE_PATTERN.exec(trimmed);
  if (zone) {
    // Resolve as if there ("9am" there may still be today), then convert.
    const there = ZONES[(zone[1] ?? "").toUpperCase()] ?? now.timeZoneId;
    const local = await resolveWhen(
      trimmed.replace(TIME_ZONE_PATTERN, " ").replace(SPACES, " "),
      { now: now.withTimeZone(there) }
    );
    return local && inZone(local, there, now.timeZoneId);
  }
  return resolvePhrase(normalizeWhen(trimmed), now);
}

/** A normalized phrase, read whole first and then in simpler forms. */
async function resolvePhrase(
  normalized: string,
  now: Temporal.ZonedDateTime
): Promise<ResolvedWhen | null> {
  const monthDay = nextMonthDay(normalized, now);
  if (monthDay) {
    return { date: monthDay, end: null, rrule: null, time: null };
  }
  // "saturday bridal trial": read only the date at the front.
  const lead = withoutTrailingWords(normalized);
  const resolved =
    (lead ? plausible(await resolveNormalized(lead, now), now) : null) ??
    plausible(await resolveNormalized(normalized, now), now);
  if (resolved) {
    return resolved;
  }
  // "tomorrow through friday": the start of a range is still a start.
  const [first, rest] = normalized.split(RANGE_WORDS);
  const start =
    rest && first ? plausible(await resolveNormalized(first, now), now) : null;
  if (start) {
    return start;
  }
  for (const simplify of SIMPLER) {
    const simpler = simplify(normalized).trim();
    if (simpler && simpler !== normalized) {
      // Sequential on purpose: the least changed reading that works wins.
      // biome-ignore lint/performance/noAwaitInLoops: see above
      const found = plausible(await resolveNormalized(simpler, now), now);
      if (found) {
        return found;
      }
    }
  }
  return resolveDateWords(normalized, now);
}

const NEXT_MONTH_DAY_PATTERN =
  /^(?:on |by )?(?:the )?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?next month$/i;
/** "the 5th of next month", which gpu-time doesn't read. */
function nextMonthDay(text: string, now: Temporal.ZonedDateTime) {
  const match = NEXT_MONTH_DAY_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const next = now.toPlainDate().add({ months: 1 });
  return next.with({ day: Math.min(Number(match[1]), next.daysInMonth) });
}

/** A clause about circumstances, not time: "after breakfast", "once it's dry". */
const QUALIFIER_PATTERN =
  /\s+(?:after|before|once|when|while|during|following|between)\s+(?!\d|noon|midnight)[^,;]*$/i;
const POSSESSIVE_PATTERN = /(\p{L}+)['’]s\b.*$/u;

/** Ways to cut a phrase down to what gpu-time can read, mildest first. */
const SIMPLER: ((text: string) => string)[] = [
  (text) => text.replaceAll(",", " ").replace(SPACES, " "),
  (text) => text.replace(POSSESSIVE_PATTERN, "$1"),
  (text) => text.replace(QUALIFIER_PATTERN, ""),
];

/**
 * Only the date words of a phrase gpu-time can't read as a whole: "our
 * check-in thu".
 */
async function resolveDateWords(text: string, now: Temporal.ZonedDateTime) {
  const words = (await findWhenPhrases(text, { now })).join(" ");
  if (!words || words === text) {
    return null;
  }
  return plausible(await resolveNormalized(words, now), now);
}

/** A date more than a year back is a misreading ("nov 2 after london open"). */
function plausible(
  resolved: ResolvedWhen | null,
  now: Temporal.ZonedDateTime
): ResolvedWhen | null {
  return resolved &&
    Temporal.PlainDate.compare(
      resolved.date,
      now.toPlainDate().subtract({ years: 1 })
    ) >= 0
    ? resolved
    : null;
}

const SPACES = /\s+/g;
const ZONES: Record<string, string> = {
  AEDT: "Australia/Sydney",
  AEST: "Australia/Sydney",
  BST: "Europe/London",
  CDT: "America/Chicago",
  CEST: "Europe/Paris",
  CET: "Europe/Paris",
  CST: "America/Chicago",
  CT: "America/Chicago",
  EDT: "America/New_York",
  EST: "America/New_York",
  ET: "America/New_York",
  GMT: "UTC",
  IST: "Asia/Kolkata",
  JST: "Asia/Tokyo",
  MDT: "America/Denver",
  MST: "America/Denver",
  MT: "America/Denver",
  PDT: "America/Los_Angeles",
  PST: "America/Los_Angeles",
  PT: "America/Los_Angeles",
  UTC: "UTC",
};
const TIME_ZONE_PATTERN = new RegExp(
  `(?<=\\d\\s*(?:[ap]\\.?m\\.?)?\\s*)\\b(${Object.keys(ZONES).join("|")})\\b`,
  "i"
);

/** "9am PST" for someone in New York is noon their time. */
function inZone(
  resolved: ResolvedWhen,
  zone: string,
  userZone: string
): ResolvedWhen {
  if (!resolved.time) {
    return resolved;
  }
  const move = (dateTime: Temporal.PlainDateTime) =>
    dateTime.toZonedDateTime(zone).withTimeZone(userZone).toPlainDateTime();
  const start = move(resolved.date.toPlainDateTime(resolved.time));
  return {
    date: start.toPlainDate(),
    end: resolved.end && move(resolved.end),
    rrule: resolved.rrule,
    time: start.toPlainTime(),
  };
}

const RANGE_WORDS = /\s+(?:through|thru)\s+/i;

async function resolveNormalized(
  trimmed: string,
  now: Temporal.ZonedDateTime
): Promise<ResolvedWhen | null> {
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
  const time = first.allDay ? null : start.toPlainTime();
  const rrule = result.rrules[0] ?? null;
  return {
    date: rrule ? start.toPlainDate() : sameWeekday(trimmed, start, now),
    end:
      first.end && RANGE_PATTERN.test(trimmed)
        ? Temporal.PlainDateTime.from(first.end)
        : null,
    rrule,
    // "in 2 weeks" lands on the current clock time, which means nothing for
    // a task; only hour and minute offsets keep it.
    time: time && isCarriedClock(trimmed, time, now) ? null : time,
  };
}

const WEEKDAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const NEXT_PATTERN = /\b(?:next|following|after)\b/i;

/**
 * "friday morning" said on a Friday is today, even once the morning is
 * over; gpu-time moves it a week out.
 */
function sameWeekday(
  text: string,
  start: Temporal.PlainDateTime,
  now: Temporal.ZonedDateTime
) {
  const today = now.toPlainDate();
  const name = WEEKDAY_NAMES[today.dayOfWeek - 1] ?? "";
  const weekLater = today.add({ days: 7 });
  return start.toPlainDate().equals(weekLater) &&
    new RegExp(`\\b${name}`, "i").test(text) &&
    !NEXT_PATTERN.test(text)
    ? today
    : start.toPlainDate();
}

/** A clock-time range: "2-2:30", "3pm to 5pm", "9 till 11". */
const RANGE_PATTERN =
  /\d\s*(?:[ap]\.?m\.?)?\s*(?:-|–|to|until|till)\s*(?:\d|noon|midnight)/i;
const CLOCK_WORDS =
  /\d\s*(?:[ap]\.?m|:\d)|\b(?:hours?|hrs?|h|minutes?|mins?|m|noon|midnight|morning|afternoon|evening|night|tonight|at)\b/i;

function isCarriedClock(
  text: string,
  time: Temporal.PlainTime,
  now: Temporal.ZonedDateTime
) {
  return (
    time.hour === now.hour &&
    time.minute === now.minute &&
    !CLOCK_WORDS.test(text)
  );
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
    const written = text.slice(start, hourEnd);
    const hour = Number.parseInt(written, 10);
    // The flagged range is only the hour of "4:30".
    const end =
      hourEnd + (MINUTES_PATTERN.exec(text.slice(hourEnd))?.[0].length ?? 0);
    // "06:30" is a 24-hour clock: the leading zero says morning.
    if (hour >= 1 && hour <= 7 && !written.startsWith("0")) {
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
