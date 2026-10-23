import { Temporal } from "temporal-polyfill";
import { resolveWhen } from "@/lib/resolve-when";

/**
 * Result of parsing a task input string with NLP syntax.
 */
export interface ParsedTaskInput {
  /** Due date from the >date token; filled by `resolveTokenDates` */
  dueDate: Temporal.PlainDate | null;
  /** Raw due date string for display (e.g., "monday", "tomorrow") */
  dueDateRaw: string | null;
  /** Duration in minutes, parsed from =duration token (e.g., =2h, =30m) */
  durationMinutes: number | null;
  /** Raw duration string for display (e.g., "2h", "30m") */
  durationRaw: string | null;
  /** URLs detected in the title text */
  links: string[];
  /** Start date from the ~date token; filled by `resolveTokenDates` */
  startDate: Temporal.PlainDate | null;
  /** Raw start date string for display (e.g., "friday", "next week") */
  startDateRaw: string | null;
  /** Start time from the ~date token ("~fri 3pm") or on-device parsing */
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
const DURATION_PATTERN = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m?)?$/;
const TOKEN_PATTERN = /([=~>#])([^=~>#]+)/g;
const FIRST_TOKEN_PATTERN = /(?<!\S)[=~>#]/;
const URL_PATTERN = /https?:\/\/\S+/g;

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
 * Parse a task input string with NLP-style syntax.
 *
 * Syntax:
 * - Title: everything before the first special token
 * - =duration: task duration (e.g., =2h, =30m, =1h30m)
 * - >date: due date (e.g., >monday, >tomorrow, >jan 15)
 * - ~date: start date (e.g., ~friday, ~next week)
 *
 * Example: "Read that book =2h >monday ~tmrw"
 * Result: { title: "Read that book", durationMinutes: 120, dueDateRaw: "monday", startDateRaw: "tmrw" }
 *
 * Runs on every keystroke, so it stays synchronous; date tokens are only
 * captured here, and `resolveTokenDates` turns them into dates.
 *
 * @param input - The raw input string from the command bar
 * @returns Parsed task input with title, duration, and raw date tokens
 */
export function parseTaskInput(input: string): ParsedTaskInput {
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
        break;
      case "~":
        // Start date token
        result.startDateRaw = trimmedValue;
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

/** The dates named by the >due and ~start tokens. */
export async function resolveTokenDates(
  {
    dueDateRaw,
    startDateRaw,
  }: Pick<ParsedTaskInput, "dueDateRaw" | "startDateRaw">,
  {
    now = Temporal.Now.zonedDateTimeISO(),
  }: { now?: Temporal.ZonedDateTime } = {}
): Promise<Pick<ParsedTaskInput, "dueDate" | "startDate" | "startTime">> {
  const [due, start] = await Promise.all([
    dueDateRaw ? resolveWhen(dueDateRaw, { now }) : null,
    startDateRaw ? resolveWhen(startDateRaw, { now }) : null,
  ]);
  return {
    dueDate: due?.date ?? null,
    startDate: start?.date ?? null,
    startTime: start?.time ?? null,
  };
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
