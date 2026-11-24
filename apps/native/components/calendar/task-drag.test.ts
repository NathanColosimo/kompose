/// <reference types="bun" />

import { expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { moveTime, snapTaskMove } from "./task-drag";

const threeDays = { dayWidth: 100, daysAfter: 1, daysBefore: 1 };

test("a drag lands on the day under the finger and the nearest slot", () => {
  expect(
    snapTaskMove({
      ...threeDays,
      fingerX: 115,
      startMinutes: 9 * 60,
      translationY: 52,
    })
  ).toEqual({ days: 1, minutes: 45 });
  expect(
    snapTaskMove({
      ...threeDays,
      fingerX: 96,
      startMinutes: 9 * 60,
      translationY: -6,
    })
  ).toEqual({ days: 0, minutes: 0 });
});

test("a move a day later and two hours earlier lands there", () => {
  const start = Temporal.ZonedDateTime.from("2026-11-23T09:00[UTC]");
  expect(
    moveTime(start, { days: 1, minutes: -120 }).toPlainDateTime().toString()
  ).toBe("2026-11-24T07:00:00");
});

test("a drag lands on a slot, and a hold without one keeps the time", () => {
  const offGrid = { ...threeDays, fingerX: 50, startMinutes: 23 * 60 + 50 };
  expect(snapTaskMove({ ...offGrid, translationY: -15 })).toEqual({
    days: 0,
    minutes: -20,
  });
  expect(snapTaskMove({ ...offGrid, translationY: 3 })).toEqual({
    days: 0,
    minutes: 0,
  });
});

test("a drag stays on the visible days", () => {
  expect(
    snapTaskMove({
      ...threeDays,
      fingerX: -350,
      startMinutes: 9 * 60,
      translationY: 0,
    })
  ).toEqual({ days: -1, minutes: 0 });
});
