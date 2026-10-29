/**
 * Minutes in a duration phrase: "30 min", "an hour and a half", "1h30",
 * "a couple hours", "forty-five minutes", "1.5 hrs", "2-3 hours". Returns
 * null when the phrase has no duration. Ranges take their lower bound.
 */
import { lookup, NUMBER_WORDS } from "./datetime/lexicon";

export function parseDuration(phrase: string): number | null {
  const words = normalize(phrase);
  if (!words) {
    return null;
  }
  const clock = CLOCK_PATTERN.exec(words);
  if (clock) {
    return toMinutes(Number(clock[1]) * 60 + Number(clock[2] ?? "0"));
  }
  const state: State = {
    found: false,
    lastUnit: null,
    minutes: 0,
    pending: null,
  };
  const tokens = words.split(" ");
  for (let index = 0; index < tokens.length; index += 1) {
    index = step(state, tokens, index);
  }
  // "1h 30": a trailing bare amount takes the next smaller unit.
  if (state.pending !== null && state.lastUnit === HOUR) {
    state.minutes += state.pending;
  } else if (state.pending !== null && !state.found) {
    // A bare number in a duration span is minutes ("45").
    state.minutes += state.pending;
    state.found = true;
  }
  return state.found ? toMinutes(state.minutes) : null;
}

interface State {
  found: boolean;
  lastUnit: number | null;
  minutes: number;
  /** Most recent bare amount, waiting for its unit. */
  pending: number | null;
}

/** Reads the token at `index`; returns the index of the last token used. */
function step(state: State, tokens: string[], index: number): number {
  const token = tokens[index] ?? "";
  const unit = lookup(UNITS, token);
  if (unit) {
    state.minutes += (state.pending ?? 1) * unit;
    state.found = true;
    state.pending = null;
    state.lastUnit = unit;
    return index;
  }
  if (token === "half" || token === "quarter") {
    return fraction(state, tokens, index, token === "half" ? 0.5 : 0.25);
  }
  const amount = amountOf(token);
  if (amount === null) {
    return index;
  }
  state.pending = (state.pending ?? 0) + amount;
  // Skip the upper bound of a range ("2-3 hours", "2 to 3 hours").
  const rangeEnd = amountOf(tokens[index + 2] ?? "");
  return tokens[index + 1] === "to" && rangeEnd !== null ? index + 2 : index;
}

function fraction(
  state: State,
  tokens: string[],
  index: number,
  value: number
) {
  // "half an hour": skip the article; the unit follows.
  const next = ARTICLES.has(tokens[index + 1] ?? "") ? index + 1 : index;
  if (lookup(UNITS, tokens[next + 1])) {
    // "half hour", "1 and a half hours"
    state.pending = (state.pending ?? 0) + value;
  } else if (state.lastUnit) {
    // "an hour and a half": the fraction is of the previous unit.
    state.minutes += value * state.lastUnit;
    state.found = true;
  }
  return next;
}

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Minutes in each unit word. */
const UNITS: Record<string, number> = {
  d: DAY,
  day: DAY,
  days: DAY,
  h: HOUR,
  hour: HOUR,
  hours: HOUR,
  hr: HOUR,
  hrs: HOUR,
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  mn: 1,
  w: WEEK,
  week: WEEK,
  weeks: WEEK,
  wk: WEEK,
  wks: WEEK,
};

const WHITESPACE_PATTERN = /\s+/;
/** "2 1/2", "3/4": a whole number and a half, third or quarter. */
const FRACTION =
  /(?:(?<![\d/.])(\d+)\s+)?(?<![\d/.])([1-3])\/([2-4])(?![\d/])/g;
const ARTICLES = new Set(["a", "an"]);
const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})$/;
const NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;

function amountOf(token: string): number | null {
  if (NUMBER_PATTERN.test(token)) {
    return Number(token);
  }
  return lookup(NUMBER_WORDS, token) ?? null;
}

/**
 * Lowercase, split numbers from units ("1h30m" → "1 h 30 m"), drop filler
 * words, and turn "½", fractions and hyphenated number words into plain
 * tokens.
 */
function normalize(phrase: string) {
  return phrase
    .toLowerCase()
    .replaceAll("½", " half ")
    .replace(FRACTION, decimal)
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)\s*[-–]\s*(\d)/g, "$1 to $2")
    .replace(/[-–]/g, " ")
    .replace(/[^a-z0-9.: ]/g, " ")
    .split(WHITESPACE_PATTERN)
    .filter((word) => word && !FILLER.has(word))
    .filter(
      (word, index, words) =>
        !ARTICLES.has(word) ||
        lookup(UNITS, words[index + 1]) !== undefined ||
        words[index - 1] === "half" ||
        words[index - 1] === "quarter"
    )
    .join(" ")
    .trim();
}

/** A fraction as a decimal: "2 1/2" → "2.5". */
function decimal(
  match: string,
  whole: string | undefined,
  top: string,
  bottom: string
) {
  return Number(top) < Number(bottom)
    ? String(Number(whole ?? 0) + Number(top) / Number(bottom))
    : match;
}

const FILLER = new Set([
  "about",
  "almost",
  "and",
  "approx",
  "approximately",
  "around",
  "for",
  "just",
  "like",
  "maybe",
  "of",
  "or",
  "roughly",
  "so",
  "takes",
]);

function toMinutes(minutes: number) {
  const rounded = Math.round(minutes);
  return rounded > 0 ? rounded : null;
}
