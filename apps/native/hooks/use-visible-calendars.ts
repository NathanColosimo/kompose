import { useCallback, useEffect, useState } from "react";
import type { VisibleCalendars } from "@/lib/visible-calendars";
import {
  loadVisibleCalendars,
  saveVisibleCalendars,
} from "@/lib/visible-calendars";

/**
 * Loads and persists the user's visible Google calendars selection.
 *
 * This mirrors the web behavior:
 * - `null` means "all calendars visible"
 * - `[]` means "none visible"
 */
export function useVisibleCalendars() {
  const [visibleCalendars, setVisibleCalendarsState] = useState<
    VisibleCalendars | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const value = await loadVisibleCalendars();
      if (!cancelled) {
        setVisibleCalendarsState(value);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setVisibleCalendars = useCallback(
    (
      updater: VisibleCalendars | ((prev: VisibleCalendars) => VisibleCalendars)
    ) => {
      setVisibleCalendarsState((prev) => {
        const previous = prev ?? null;
        const next =
          typeof updater === "function" ? updater(previous) : updater;

        // Persist in the background; if this fails we still keep state in memory.
        saveVisibleCalendars(next).catch(() => undefined);
        return next;
      });
    },
    []
  );

  return { visibleCalendars, setVisibleCalendars };
}
