import { expect, test } from "bun:test";
import {
  containsPoint,
  fitWindowBounds,
  parsePoint,
  parseWindowState,
} from "./window-state";

const minimum = { height: 480, width: 720 };
const laptop = { height: 850, width: 1440, x: 0, y: 25 };

test("saved placement is retained on a display with negative coordinates", () => {
  const display = { height: 1080, width: 1920, x: -1920, y: -500 };
  const saved = { height: 700, width: 1100, x: -1800, y: -400 };
  expect(fitWindowBounds(saved, display, minimum)).toEqual(saved);
});

test("windows return fully onscreen after their previous display is removed", () => {
  const saved = { height: 840, width: 1280, x: 2800, y: -900 };
  expect(fitWindowBounds(saved, laptop, minimum)).toEqual({
    height: 840,
    width: 1280,
    x: 160,
    y: 25,
  });
  expect(
    fitWindowBounds({ ...saved, height: 2000, width: 3000 }, laptop, minimum)
  ).toEqual(laptop);
});

test("a popup growing near the bottom shifts up, then returns to its anchor", () => {
  const popupMinimum = { height: 56, width: 480 };
  const anchor = { x: 850, y: 790 };
  const fit = (height: number) =>
    fitWindowBounds({ ...anchor, height, width: 480 }, laptop, popupMinimum);
  expect(fit(360)).toEqual({ height: 360, width: 480, x: 850, y: 515 });
  // Fitting always starts from the anchor, so shrinking restores the position.
  expect(fit(80)).toEqual({ height: 80, width: 480, x: 850, y: 790 });
});

test("only points inside the work area count as on that display", () => {
  expect(containsPoint(laptop, { x: 0, y: 25 })).toBe(true);
  expect(containsPoint(laptop, { x: 1440, y: 100 })).toBe(false);
  expect(containsPoint(laptop, { x: 100, y: 0 })).toBe(false);
});

test("invalid stored state cannot reach native window APIs", () => {
  for (const bounds of [
    null,
    {},
    { ...laptop, x: Number.NaN },
    { ...laptop, height: 0 },
    { ...laptop, width: -1 },
    { ...laptop, y: "0" },
  ]) {
    expect(parseWindowState({ bounds, maximized: false })).toBeUndefined();
  }
  expect(parseWindowState(undefined)).toBeUndefined();
  expect(parseWindowState({ bounds: laptop, maximized: "yes" })).toEqual({
    bounds: laptop,
    maximized: false,
  });
  expect(parsePoint({ x: 1, y: Number.POSITIVE_INFINITY })).toBeUndefined();
  expect(parsePoint({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
});
