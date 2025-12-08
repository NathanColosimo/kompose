import type { Colors } from "@kompose/google-cal/schema";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import { atomWithQuery } from "jotai-tanstack-query";
import { orpc } from "@/utils/orpc";

const TWENTY_MINUTES_MS = 20 * 60 * 1000;

/**
 * Colors palette per Google account, backed by TanStack Query cache.
 * Consumers can read via useAtomValue(googleColorsAtomFamily(accountId)).
 */
export const googleColorsAtomFamily = atomFamily((accountId: string) =>
  atomWithQuery<Colors>(() => {
    const options = orpc.googleCal.colors.list.queryOptions({
      input: { accountId },
    });

    return {
      ...options,
      staleTime: TWENTY_MINUTES_MS,
    };
  })
);

/**
 * Derived resolver for a given account to compute calendar colors using palette
 * plus the calendar's own RGB overrides.
 */
export const calendarColorResolverAtomFamily = atomFamily((accountId: string) =>
  atom((get) => {
    const { data: palette } = get(googleColorsAtomFamily(accountId));

    return (calendar: {
      colorId?: string;
      backgroundColor?: string;
      foregroundColor?: string;
    }) => {
      const paletteEntry =
        calendar.colorId && palette?.calendar
          ? palette.calendar[calendar.colorId]
          : undefined;

      return {
        backgroundColor: calendar.backgroundColor ?? paletteEntry?.background,
        foregroundColor: calendar.foregroundColor ?? paletteEntry?.foreground,
      };
    };
  })
);
