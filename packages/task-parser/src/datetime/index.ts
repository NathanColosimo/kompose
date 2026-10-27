/**
 * Our own date phrase parser: "tmrw 3", "every other mon starting nov 3",
 * "mañana a las 5", "quarter to five", "9am PT". Deterministic and
 * synchronous; replaces gpu-time.
 */
import { Temporal } from "temporal-polyfill";
import { parsePhrase } from "./grammar";
import { resolvePhrase, type When } from "./resolve";
import { tokenize } from "./tokens";

export type { When } from "./resolve";

/**
 * The first occurrence of a date phrase, or null when it names no date or
 * time. `repeating` reads bare weekdays as a schedule ("mon wed fri").
 */
export function parseWhen(
  text: string,
  {
    now = Temporal.Now.zonedDateTimeISO(),
    repeating = false,
  }: { now?: Temporal.ZonedDateTime; repeating?: boolean } = {}
): When | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return null;
  }
  return resolvePhrase(parsePhrase(tokens, repeating), now);
}

/** Whether a phrase gives only a time of day ("4pm", "17h", "half nine"). */
export function isClockOnly(text: string): boolean {
  const phrase = parsePhrase(tokenize(text));
  return (
    (phrase.time !== null || phrase.part !== null || phrase.noTime) &&
    phrase.day === null &&
    phrase.repeat === null &&
    phrase.start === null
  );
}
