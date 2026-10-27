import { Temporal } from "temporal-polyfill";
import { parseWhen, type When } from "./datetime";

/**
 * Date and time phrases ("next tue 3pm", "the 15th", "every weekday at 9")
 * resolve through our own grammar (src/datetime), synchronously, in a few
 * microseconds.
 */
export type ResolvedWhen = When;

/** The first occurrence of a date phrase; a repeat resolves to its first date. */
export function resolveWhen(
  text: string,
  {
    now = Temporal.Now.zonedDateTimeISO(),
    repeating = false,
  }: { now?: Temporal.ZonedDateTime; repeating?: boolean } = {}
): ResolvedWhen | null {
  return text.trim() ? parseWhen(text, { now, repeating }) : null;
}
