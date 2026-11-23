/// <reference types="bun" />

import { expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { moveTime, snapTaskMove } from "./task-drag";

const threeDays = { dayWidth: 100, daysAfter: 1, daysBefore: 1 };

test("a drag snaps to the nearest day and 15 minutes", () => {
  expect(
    snapTaskMove({
      ...threeDays,
      startMinutes: 9 * 60,
      translationX: 60,
      translationY: 52,
    })
  ).toEqual({ days: 1, minutes: 45 });
  expect(
    snapTaskMove({
      ...threeDays,
      startMinutes: 9 * 60,
      translationX: -4,
      translationY: -6,
    })
  ).toEqual({ days: 0, minutes: 0 });
});

test("a move a day later and two hours earlier lands there", () => {
  const start = Temporal.PlainDateTime.from("2026-11-23T09:00");
  expect(moveTime(start, { days: 1, minutes: -120 }).toString()).toBe(
    "2026-11-24T07:00:00"
  );
});

test("a drag stays on the visible days", () => {
  expect(
    snapTaskMove({
      ...threeDays,
      startMinutes: 9 * 60,
      translationX: -350,
      translationY: 0,
    })
  ).toEqual({ days: -1, minutes: 0 });
});

test("a drag keeps the task's start inside the day", () => {
  expect(
    snapTaskMove({
      ...threeDays,
      startMinutes: 60,
      translationX: 0,
      translationY: -300,
    })
  ).toEqual({ days: 0, minutes: -60 });
  expect(
    snapTaskMove({
      ...threeDays,
      startMinutes: 23 * 60,
      translationX: 0,
      translationY: 300,
    })
  ).toEqual({ days: 0, minutes: 45 });
});
