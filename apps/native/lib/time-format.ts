/**
 * The device's clock style for time pickers: "12" where the locale shows
 * AM/PM ("4:30 PM"), "24" where it doesn't ("16:30"), so pickers match the
 * calendar's own times.
 */
export const LOCALE_TIME_FORMAT: "12" | "24" = (() => {
  const { hourCycle } = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
  }).resolvedOptions();
  return hourCycle === "h11" || hourCycle === "h12" ? "12" : "24";
})();
