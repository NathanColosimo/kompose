import { parseDate } from "chrono-node";
import { Temporal } from "temporal-polyfill";

/**
 * Result of parsing a task input string with NLP syntax.
 */
export interface ParsedTaskInput {
  /** The task title (text before any special tokens) */
  title: string;
  /** Duration in minutes, parsed from =duration token (e.g., =2h, =30m) */
  durationMinutes: number | null;
  /** Due date, parsed from >date token (e.g., >monday, >tomorrow) */
  dueDate: Temporal.PlainDate | null;
  /** Start date, parsed from ~date token (e.g., ~friday, ~next week) */
  startDate: Temporal.PlainDate | null;
  /** Tag names parsed from #tag tokens */
  tagNames: string[];
  /** Raw duration string for display (e.g., "2h", "30m") */
  durationRaw: string | null;
  /** Raw due date string for display (e.g., "monday", "tomorrow") */
  dueDateRaw: string | null;
  /** Raw start date string for display (e.g., "friday", "next week") */
  startDateRaw: string | null;
  /** Raw tag strings for display (e.g., "design", "client work") */
  tagNamesRaw: string[];
}

/**
 * Regex patterns for extracting special tokens from input.
 * Tokens are: =duration, >dueDate, ~startDate
 * Each pattern captures the value after the symbol until the next token or end.
 */
const DURATION_PATTERN = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m?)?$/;
const TOKEN_PATTERN = /([=~>#])([^=~>#]+)/g;
const FIRST_TOKEN_PATTERN = /[=~>#]/;

/**
 * Parse duration string into minutes.
 * Supports formats: "2h", "30m", "1h30m", "90"
 *
 * @param durationStr - The duration string (e.g., "2h", "30m", "1h30m")
 * @returns Duration in minutes, or null if parsing fails
 */
function parseDuration(durationStr: string): number | null {
  const trimmed = durationStr.trim().toLowerCase();

  // Match hours and/or minutes: "2h", "30m", "1h30m", "2h30"
  const match = trimmed.match(DURATION_PATTERN);
  if (!match) {
    return null;
  }

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;

  if (hours === 0 && minutes === 0) {
    return null;
  }

  return hours * 60 + minutes;
}

/**
 * Convert a JavaScript Date to a Temporal.PlainDate.
 */
function dateToPlainDate(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/**
 * Parse a natural language date string using chrono-node.
 *
 * @param dateStr - The date string (e.g., "monday", "tomorrow", "jan 15")
 * @param referenceDate - The reference date for relative parsing (defaults to now)
 * @returns Temporal.PlainDate or null if parsing fails
 */
function parseNaturalDate(
  dateStr: string,
  referenceDate?: Date
): Temporal.PlainDate | null {
  const parsed = parseDate(dateStr.trim(), referenceDate);
  if (!parsed) {
    return null;
  }
  return dateToPlainDate(parsed);
}

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
 * @param referenceDate - Reference date for parsing relative dates (defaults to now)
 * @returns Parsed task input with title, duration, and dates
 */
export function parseTaskInput(
  input: string,
  referenceDate?: Date
): ParsedTaskInput {
  const result: ParsedTaskInput = {
    title: "",
    durationMinutes: null,
    dueDate: null,
    startDate: null,
    tagNames: [],
    durationRaw: null,
    dueDateRaw: null,
    startDateRaw: null,
    tagNamesRaw: [],
  };

  // Find the first special token to extract the title
  const firstTokenMatch = input.match(FIRST_TOKEN_PATTERN);
  if (firstTokenMatch?.index !== undefined) {
    result.title = input.slice(0, firstTokenMatch.index).trim();
  } else {
    // No special tokens, entire input is the title
    result.title = input.trim();
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
        result.dueDate = parseNaturalDate(trimmedValue, referenceDate);
        break;
      case "~":
        // Start date token
        result.startDateRaw = trimmedValue;
        result.startDate = parseNaturalDate(trimmedValue, referenceDate);
        break;
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
