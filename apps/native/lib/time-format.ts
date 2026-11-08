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
