import type { Temporal } from "temporal-polyfill";

/**
 * The device's clock style for time pickers: "12" where the locale shows
 * AM/PM ("4:30 PM"), "24" where it doesn't ("16:30"), so pickers match the
 * calendar's own times. Read at render, so a change in Settings applies
 * without a restart.
 */
export function localeTimeFormat(): "12" | "24" {
  const { hourCycle } = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
  }).resolvedOptions();
  return hourCycle === "h11" || hourCycle === "h12" ? "12" : "24";
}

/** A Temporal date as a local midnight Date, for Intl and the pickers. */
export function plainDateToDate(plainDate: Temporal.PlainDate): Date {
  return new Date(plainDate.year, plainDate.month - 1, plainDate.day);
}

/** "Nov 8": the short date the task rows and the editor's chips show. */
export function formatShortDate(date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(plainDateToDate(date));
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * A duration for VoiceOver ("1 hour 30 minutes"), where the compact "30m"
 * on screen would be read as meters.
 */
export function spokenDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return plural(rest, "minute");
  }
  return rest === 0
    ? plural(hours, "hour")
    : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}
