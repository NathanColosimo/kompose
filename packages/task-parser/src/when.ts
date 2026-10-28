/**
 * Date phrases → dates: "tmrw 3", "every other mon starting nov 3",
 * "mañana a las 5", "quarter to five", "9am PT". Deterministic and
 * synchronous.
 */
import { Temporal } from "temporal-polyfill";
import { parsePhrase } from "./datetime/grammar";
import { resolvePhrase } from "./datetime/resolve";
import { tokenize } from "./datetime/tokens";

/**
 * The first occurrence of a date phrase (a repeat's first date), or null
 * when it names no date or time. `repeating` reads bare weekdays as a
 * schedule ("mon wed fri").
 */
export function resolveWhen(
  text: string,
  {
    now = Temporal.Now.zonedDateTimeISO(),
    repeating = false,
  }: { now?: Temporal.ZonedDateTime; repeating?: boolean } = {}
) {
  return resolvePhrase(parsePhrase(tokenize(text), repeating), now);
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
