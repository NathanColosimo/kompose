import { expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { currentTimePosition } from "./current-time-position";

test("the now line moves to the next column at midnight without grid remount", () => {
  const yesterday = Temporal.PlainDate.from("2026-10-07");
  const today = yesterday.add({ days: 1 });
  const before = Temporal.ZonedDateTime.from(
    "2026-10-07T23:59[America/New_York]"
  );
  const after = before.add({ minutes: 2 });
  expect(currentTimePosition(yesterday, "America/New_York", before, 60)).toBe(
    1439
  );
  expect(currentTimePosition(today, "America/New_York", before, 60)).toBeNull();
  expect(
    currentTimePosition(yesterday, "America/New_York", after, 60)
  ).toBeNull();
  expect(currentTimePosition(today, "America/New_York", after, 60)).toBe(1);
});

test("the displayed time zone determines both day and position", () => {
  const now = Temporal.ZonedDateTime.from("2026-10-08T01:30[America/New_York]");
  expect(
    currentTimePosition(
      Temporal.PlainDate.from("2026-10-07"),
      "America/Los_Angeles",
      now,
      60
    )
  ).toBe(1350);
  expect(
    currentTimePosition(
      Temporal.PlainDate.from("2026-10-08"),
      "America/Los_Angeles",
      now,
      60
    )
  ).toBeNull();
});
