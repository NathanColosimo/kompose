import { expect, test } from "bun:test";
import { fitWindowBounds, isWindowBounds } from "./window-state";

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

test("expanding a popup near the bottom keeps its contents within the work area", () => {
  expect(
    fitWindowBounds({ height: 360, width: 480, x: 850, y: 790 }, laptop, {
      height: 56,
      width: 480,
    })
  ).toEqual({ height: 360, width: 480, x: 850, y: 515 });
});

test("invalid stored bounds cannot reach native window APIs", () => {
  for (const value of [
    null,
    {},
    { ...laptop, x: Number.NaN },
    { ...laptop, height: 0 },
    { ...laptop, width: -1 },
    { ...laptop, y: "0" },
  ]) {
    expect(isWindowBounds(value)).toBe(false);
  }
  expect(isWindowBounds(laptop)).toBe(true);
});
