/**
 * Why Kompose won't make a series write, and the words that tell the user.
 */
import { Temporal } from "temporal-polyfill";

/**
 * Why a series write is refused, before anything changes, with no
 * occurrences to name. `endsBeforeStart`, `deleteFromAddedOccurrence` and
 * `countUnknown` are kept because no write through Google's API does what
 * was asked safely. `severalRules`, `addedOccurrence` and
 * `severalTimesADay` are refused until a later change writes what a safe
 * write exists for.
 */
export const PLAIN_REFUSALS = [
  // This and following in a series with several rules (or an exclusion
  // rule): a new series has one start, and Google counts every rule's
  // days, phase and COUNT from it.
  "severalRules",
  // This and following from an added meeting off the rule's days: a new
  // series starting there would count its rule's days and time from it.
  "addedOccurrence",
  // The save's own repeat ends before the new series' first meeting.
  "endsBeforeStart",
  // Deleting This and following from an added meeting, where one rule's
  // end can't be worked out and another rule never ends: Google's list of
  // the series' meetings never ends either, so which are that rule's
  // can't be told.
  "deleteFromAddedOccurrence",
  // A kept COUNT whose meetings left can't be told: the rule can't be
  // walked, and Google's list can't tell a skip or an added day before the
  // split from one of the rule's own.
  "countUnknown",
  // A new time for an entire series that meets several times a day: its
  // start's time is one of several, each a rule of its own.
  "severalTimesADay",
] as const;

/**
 * Refusals that name, by original start, the occurrences changed on their
 * own that Google would drop (a new start, or a rule without their slot)
 * or whose own length it would overwrite (a new length). Writing them back
 * afterwards can fail with nothing to restore them from.
 */
export const NAMING_REFUSALS = [
  "dropsChangedOccurrences",
  "resizesChangedOccurrences",
] as const;

/** Why a series write is refused (see `PLAIN_REFUSALS`, `NAMING_REFUSALS`). */
export type SeriesRefusal =
  | { readonly reason: (typeof PLAIN_REFUSALS)[number] }
  | {
      readonly reason: (typeof NAMING_REFUSALS)[number];
      readonly originalStarts: readonly string[];
      /** Only a series takes it: a new repeat, or a calendar move. */
      readonly seriesOnly?: true;
    };

/** A refusal that names the occurrences it's for. */
type NamingRefusal = Extract<SeriesRefusal, { originalStarts: unknown }>;

/** "Mar 31": an original start's day, as the refusal names it. */
function dayName(originalStart: string): string {
  return Temporal.PlainDate.from(originalStart.slice(0, 10)).toLocaleString(
    "en-US",
    { day: "numeric", month: "short" }
  );
}

/** "Nov 23, Nov 30": the occurrences a refusal names. */
function namedDays(originalStarts: readonly string[]): string {
  return originalStarts.map(dayName).join(", ");
}

/**
 * Where the save can go instead: This and following after the last named
 * occurrence, or this occurrence alone when it can take the save.
 */
function elsewhere(refusal: NamingRefusal): string {
  const last = refusal.originalStarts
    .map((start) => start.slice(0, 10))
    .sort()
    .at(-1);
  const following = `This and following${last ? ` from an occurrence after ${dayName(last)}` : ""}`;
  return refusal.seriesOnly
    ? `Save it with ${following}.`
    : `Save it for this occurrence only, or with ${following}.`;
}

/** The refusal in words for the user. */
export function refusalMessage(refusal: SeriesRefusal): string {
  switch (refusal.reason) {
    case "severalRules":
      return "This and following isn't available for a series with more than one rule.";
    case "addedOccurrence":
      return "This and following isn't available for an occurrence added to the series on its own.";
    case "deleteFromAddedOccurrence":
      return "Deleting this and following isn't available from this added occurrence: one of the series' rules never ends, and where another ends can't be worked out.";
    case "endsBeforeStart":
      return "The repeat ends before this occurrence, so it can't start a new series here. Pick a later end.";
    case "countUnknown":
      return "This and following isn't available for this series: how many times it has left to repeat can't be worked out.";
    case "severalTimesADay":
      return "This series' meetings keep times of their own, so its time can't be changed for the entire series. Change one occurrence at a time.";
    case "dropsChangedOccurrences":
      return `This would undo changes made to single occurrences (${namedDays(refusal.originalStarts)}), so it wasn't saved. ${elsewhere(refusal)}`;
    case "resizesChangedOccurrences":
      return `This would also change the length of single occurrences given a length of their own (${namedDays(refusal.originalStarts)}), so it wasn't saved. ${elsewhere(refusal)}`;
    default:
      return refusal satisfies never;
  }
}
