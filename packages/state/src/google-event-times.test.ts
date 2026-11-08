import { expect, test } from "bun:test";
import { withEditedTime } from "./google-event-times";

test("an edited time replaces the source's date form, keeping its zone", () => {
  const timed = {
    dateTime: "2026-11-10T09:00:00-05:00",
    timeZone: "America/New_York",
  };
  expect(withEditedTime(timed, { date: "2026-11-10" })).toEqual({
    date: "2026-11-10",
    timeZone: "America/New_York",
  });
  expect(
    withEditedTime(
      { date: "2026-11-10" },
      {
        dateTime: "2026-11-10T14:00:00.000Z",
      }
    )
  ).toEqual({ dateTime: "2026-11-10T14:00:00.000Z" });
});
