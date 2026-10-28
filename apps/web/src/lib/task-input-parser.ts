import { parseDuration } from "@kompose/task-parser/duration";
import { resolveWhen } from "@kompose/task-parser/when";
import { Temporal } from "temporal-polyfill";

/**
 * Result of parsing a task input string with NLP syntax.
 */
export interface ParsedTaskInput {
  /** Due date from the >date token (e.g., >monday, >tomorrow) */
  dueDate: Temporal.PlainDate | null;
  /** Raw due date string for display (e.g., "monday", "tomorrow") */
  dueDateRaw: string | null;
  /** Duration in minutes, parsed from =duration token (e.g., =2h, =30m) */
  durationMinutes: number | null;
  /** Raw duration string for display (e.g., "2h", "30m") */
  durationRaw: string | null;
  /** URLs detected in the title text */
  links: string[];
  /** Start date from the ~date token (e.g., ~friday, ~next week) */
  startDate: Temporal.PlainDate | null;
  /** Raw start date string for display (e.g., "friday", "next week") */
  startDateRaw: string | null;
  /** Start time from the ~date token (e.g., ~fri 3pm) */
  startTime: Temporal.PlainTime | null;
  /** Tag names parsed from #tag tokens */
  tagNames: string[];
  /** Raw tag strings for display (e.g., "design", "client work") */
  tagNamesRaw: string[];
  /** The task title (text before any special tokens) */
  title: string;
}

/**
 * Regex patterns for extracting special tokens from input.
 * Tokens are: =duration, >dueDate, ~startDate
 * Each pattern captures the value after the symbol until the next token or end.
 */
const TOKEN_PATTERN = /([=~>#])([^=~>#]+)/g;
const FIRST_TOKEN_PATTERN = /(?<!\S)[=~>#]/;
const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Parse a task input string with NLP-style syntax.
 *
 * Syntax:
 * - Title: everything before the first special token
 * - =duration: task duration (e.g., =2h, =30m, =1h30m)
 * - >date: due date (e.g., >monday, >tomorrow, >jan 15)
 * - ~date: start date (e.g., ~friday, ~next week)
 *
 * Example: "Read that book =2h >monday ~tmrw"
 * Result: { title: "Read that book", durationMinutes: 120, dueDate: Monday, startDate: Tomorrow }
 *
 * @param input - The raw input string from the command bar
 * @param now - Reference time for relative dates (defaults to now)
 * @returns Parsed task input with title, duration, and dates
 */
export function parseTaskInput(
  input: string,
  now = Temporal.Now.zonedDateTimeISO()
): ParsedTaskInput {
  const result: ParsedTaskInput = {
    dueDate: null,
    dueDateRaw: null,
    durationMinutes: null,
    durationRaw: null,
    links: [],
    startDate: null,
    startDateRaw: null,
    startTime: null,
    tagNames: [],
    tagNamesRaw: [],
    title: "",
  };

  // Find the first special token to extract the title
  const firstTokenMatch = input.match(FIRST_TOKEN_PATTERN);
  if (firstTokenMatch?.index === undefined) {
    // No special tokens, entire input is the title
    result.title = input.trim();
  } else {
    result.title = input.slice(0, firstTokenMatch.index).trim();
  }

  // Extract all URLs from the title portion (before special tokens)
  const urlMatches = [...result.title.matchAll(URL_PATTERN)];
  if (urlMatches.length > 0) {
    result.links = urlMatches.map((m) => m[0]);
    result.title = result.title.replace(URL_PATTERN, "").trim();
  }

  // Return early if there were no special tokens
  if (firstTokenMatch?.index === undefined) {
    return result;
  }

  // Extract all tokens from the input
  const tokenSection = input.slice(firstTokenMatch.index);
  let match: RegExpExecArray | null;

  // Reset regex state
  TOKEN_PATTERN.lastIndex = 0;

  while (true) {
    match = TOKEN_PATTERN.exec(tokenSection);
    if (!match) {
      break;
    }
    const [, symbol, value] = match;
    const trimmedValue = value.trim();

    switch (symbol) {
      case "=":
        // Duration token
        result.durationRaw = trimmedValue;
        result.durationMinutes = parseDuration(trimmedValue);
        break;
      case ">":
        // Due date token
        result.dueDateRaw = trimmedValue;
        result.dueDate = resolveWhen(trimmedValue, { now })?.date ?? null;
        break;
      case "~": {
        // Start date token, with an optional time ("~fri 3pm")
        const start = resolveWhen(trimmedValue, { now });
        result.startDateRaw = trimmedValue;
        result.startDate = start?.date ?? null;
        result.startTime = start?.time ?? null;
        break;
      }
      case "#":
        result.tagNamesRaw.push(trimmedValue);
        if (trimmedValue) {
          result.tagNames.push(trimmedValue);
        }
        break;
      default:
        break;
    }
  }

  return result;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
}
