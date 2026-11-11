/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { clipToDay, resizedRange } from "./helpers";

const zone = "America/New_York";
const at = (date: string, time: string) =>
  Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone);
const times = (range: ReturnType<typeof resizedRange>) =>
  range && [range.start.toString(), range.end.toString()];

describe("resizedRange", () => {
  const start = at("2026-11-09", "10:00");
  const end = at("2026-11-09", "11:00");

  test("moves the dragged edge", () => {
    expect(
      times(
        resizedRange({
          direction: "end",
          end,
          start,
          target: at("2026-11-09", "11:30"),
        })
      )
    ).toEqual(times({ end: at("2026-11-09", "11:30"), start }));
    expect(
      times(
        resizedRange({
          direction: "start",
          end,
          start,
          target: at("2026-11-09", "09:15"),
        })
      )
    ).toEqual(times({ end, start: at("2026-11-09", "09:15") }));
  });

  test("keeps the item at least 15 minutes long", () => {
    expect(
      resizedRange({
        direction: "end",
        end,
        start,
        target: at("2026-11-09", "09:00"),
      })?.end.toString()
    ).toBe(at("2026-11-09", "10:15").toString());
    expect(
      resizedRange({
        direction: "start",
        end,
        start,
        target: at("2026-11-09", "11:30"),
      })?.start.toString()
    ).toBe(at("2026-11-09", "10:45").toString());
  });

  test("ignores a target on another day", () => {
    expect(
      resizedRange({
        direction: "end",
        end,
        start,
        target: at("2026-11-10", "10:00"),
      })
    ).toBeNull();
  });

  test("drags an overnight item's end on its second day", () => {
    const nightStart = at("2026-11-09", "23:00");
    const nightEnd = at("2026-11-10", "07:45");
    expect(
      times(
        resizedRange({
          direction: "end",
          end: nightEnd,
          start: nightStart,
          target: at("2026-11-10", "09:00"),
        })
      )
    ).toEqual(times({ end: at("2026-11-10", "09:00"), start: nightStart }));
    // Its start stays on the first day.
    expect(
      resizedRange({
        direction: "start",
        end: nightEnd,
        start: nightStart,
        target: at("2026-11-10", "01:00"),
      })
    ).toBeNull();
  });

  test("treats an end at midnight as the day before", () => {
    const lateStart = at("2026-11-09", "22:00");
    const midnight = at("2026-11-10", "00:00");
    expect(
      resizedRange({
        direction: "end",
        end: midnight,
        start: lateStart,
        target: at("2026-11-09", "23:00"),
      })?.end.toString()
    ).toBe(at("2026-11-09", "23:00").toString());
  });
});

test("extends an item's end to midnight", () => {
  const midnight = at("2026-11-10", "00:00");
  expect(
    resizedRange({
      direction: "end",
      end: at("2026-11-09", "23:00"),
      start: at("2026-11-09", "22:00"),
      target: midnight,
    })?.end.toString()
  ).toBe(midnight.toString());
});

describe("clipToDay", () => {
  test("keeps the part of a range on one day", () => {
    const range = {
      end: at("2026-11-10", "07:45"),
      start: at("2026-11-09", "23:00"),
    };
    expect(
      times(clipToDay(range, Temporal.PlainDate.from("2026-11-10")))
    ).toEqual(
      times({
        end: at("2026-11-10", "07:45"),
        start: at("2026-11-10", "00:00"),
      })
    );
  });
});
