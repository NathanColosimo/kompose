import type { Colors } from "@kompose/google-cal/schema";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import { atomWithQuery } from "jotai-tanstack-query";
import { orpc } from "@/utils/orpc";

const TWENTY_MINUTES_MS = 20 * 60 * 1000;

const PASTEL_MAX_SATURATION = 0.55;
const PASTEL_MIN_LIGHTNESS = 0.78;

/**
 * Colors palette per Google account, backed by TanStack Query cache.
 * Consumers can read via useAtomValue(googleColorsAtomFamily(accountId)).
 */
const googleColorsAtomFamily = atomFamily((accountId: string) =>
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

export const normalizedGoogleColorsAtomFamily = atomFamily(
  (accountId: string) =>
    atom((get) => {
      const { data } = get(googleColorsAtomFamily(accountId));
      if (!data) {
        return data;
      }

      const normalizeRecord = (
        record?: Record<string, { background?: string; foreground?: string }>
      ) => {
        if (!record) {
          return record;
        }
        const next: typeof record = {};
        for (const [key, value] of Object.entries(record)) {
          next[key] = {
            background: pastelizeColor(value.background),
            foreground: value.foreground ?? "#1d1d1d",
          };
        }
        return next;
      };

      return {
        ...data,
        calendar: normalizeRecord(data.calendar),
        event: normalizeRecord(data.event),
      } satisfies Colors;
    })
);

// --- Pastel normalization helpers ---

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return null;
  }
  return { r, g, b };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => {
        const clamped = Math.max(0, Math.min(255, Math.round(v)));
        return clamped.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }) {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rN) {
      h = ((gN - bN) / delta) % 6;
    } else if (max === gN) {
      h = (bN - rN) / delta + 2;
    } else {
      h = (rN - gN) / delta + 4;
    }
  }
  h = Math.round(h * 60);
  if (h < 0) {
    h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): {
  r: number;
  g: number;
  b: number;
} {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rN = 0;
  let gN = 0;
  let bN = 0;

  if (h >= 0 && h < 60) {
    rN = c;
    gN = x;
  } else if (h < 120) {
    rN = x;
    gN = c;
  } else if (h < 180) {
    gN = c;
    bN = x;
  } else if (h < 240) {
    gN = x;
    bN = c;
  } else if (h < 300) {
    rN = x;
    bN = c;
  } else {
    rN = c;
    bN = x;
  }

  return {
    r: (rN + m) * 255,
    g: (gN + m) * 255,
    b: (bN + m) * 255,
  };
}

export function pastelizeColor(hex?: string | null): string | undefined {
  if (!hex) {
    return;
  }
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return;
  }
  const hsl = rgbToHsl(rgb);
  const s = Math.min(hsl.s, PASTEL_MAX_SATURATION);
  const l = Math.max(hsl.l, PASTEL_MIN_LIGHTNESS);
  const pastelRgb = hslToRgb({ h: hsl.h, s, l });
  return rgbToHex(pastelRgb);
}
