import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { resolveWhen } from "./when";

// Friday, Oct 23 2026, 10:00 in New York.
const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe("resolveWhen", () => {
  test.each([
    // [phrase, date, time or null]
    ["tomorrow", "2026-10-24", null],
    ["tmr", "2026-10-24", null],
    ["tomorrow at 4am", "2026-10-24", "04:00:00"],
    ["next tue 3pm", "2026-10-27", "15:00:00"],
    ["noon tmrw", "2026-10-24", "12:00:00"],
    ["in 45 minutes", "2026-10-23", "10:45:00"],
    ["end of month", "2026-10-31", null],
    ["nov 1", "2026-11-01", null],
    ["the 15th", "2026-11-15", null],
    ["on the 1st", "2026-11-01", null],
    ["weds", "2026-10-28", null],
    ["first monday of next month", "2026-11-02", null],
    ["3pm-5pm thursday", "2026-10-29", "15:00:00"],
    ["tuesday 2-3:30pm", "2026-10-27", "14:00:00"],
    ["tue 2-4", "2026-10-27", "14:00:00"],
    ["thu 9-10am", "2026-10-29", "09:00:00"],
    ["11-1pm fri", "2026-10-23", "11:00:00"],
    ["thu 10/29", "2026-10-29", null],
    ["18h", "2026-10-23", "18:00:00"],
    ["9h30 tomorrow", "2026-10-24", "09:30:00"],
    ["in 2h", "2026-10-23", "12:00:00"],
    ["first thing tomorrow", "2026-10-24", "09:00:00"],
    ["tomorrow at lunch", "2026-10-24", "12:00:00"],
    ["3pm ET", "2026-10-23", "15:00:00"],
    ["9am PST", "2026-10-23", "12:00:00"],
    ["14:00 UTC", "2026-10-23", "10:00:00"],
    ["friday nights at 9", "2026-10-23", "21:00:00"],
    ["tomorrow half nine", "2026-10-24", "09:30:00"],
    ["Nov 2, 10:00", "2026-11-02", "10:00:00"],
    ["saturday morning, nov 1", "2026-11-01", "09:00:00"],
    ["mañana a las 6", "2026-10-24", "18:00:00"],
    ["demain matin", "2026-10-24", "09:00:00"],
    ["明日の朝", "2026-10-24", "09:00:00"],
    ["11/3 0630", "2026-11-03", "06:30:00"],
    ["tomorrow 1545", "2026-10-24", "15:45:00"],
    ["at 2130", "2026-10-23", "21:30:00"],
    ["nov 3 2026", "2026-11-03", null],
    ["tonight", "2026-10-23", "20:00:00"],
    ["tonight about eight", "2026-10-23", "20:00:00"],
    ["tmrw 4ish", "2026-10-24", "16:00:00"],
    ["wednesday around four", "2026-10-28", "16:00:00"],
    ["thursday at nine forty five", "2026-10-29", "09:45:00"],
    ["mañana a las cuatro", "2026-10-24", "16:00:00"],
    ["sat morn", "2026-10-24", "09:00:00"],
    ["thurs a.m.", "2026-10-29", "09:00:00"],
    ["5 tmrw", "2026-10-24", "17:00:00"],
    ["12–2 tomorrow", "2026-10-24", "12:00:00"],
    ["10/23 after 6", "2026-10-23", "18:00:00"],
    ["tuesday's 11am appointment", "2026-10-27", "11:00:00"],
  ])("%p", (phrase, date, time) => {
    const when = resolveWhen(phrase, { now });
    expect(when?.date.toString()).toBe(date);
    expect(when?.time?.toString() ?? null).toBe(time);
  });

  test.each([
    ["at 4", "2026-10-23", "16:00:00"],
    ["4:30", "2026-10-23", "16:30:00"],
    ["from 3 to 5", "2026-10-23", "15:00:00"],
    ["tomorrow at 4", "2026-10-24", "16:00:00"],
    ["in 2 days at 4", "2026-10-25", "16:00:00"],
  ])("reads a bare low hour in %p as the afternoon", (phrase, date, time) => {
    const when = resolveWhen(phrase, { now });
    expect(when?.date.toString()).toBe(date);
    expect(when?.time?.toString()).toBe(time);
  });

  test("keeps an ambiguous morning hour in the morning", () => {
    const when = resolveWhen("tomorrow at 9:30", { now });
    expect(when?.time?.toString()).toBe("09:30:00");
  });

  test("starts a day part at a plausible time", () => {
    const when = resolveWhen("sat morning", { now });
    expect(when?.time?.toString()).toBe("09:00:00");
  });

  test("resolves a recurrence to its next date", () => {
    const when = resolveWhen("every weekday at 9:30", { now });
    expect(when?.date.toString()).toBe("2026-10-26");
    expect(when?.time?.toString()).toBe("09:30:00");
  });

  test("returns null without a date", () => {
    expect(resolveWhen("groceries", { now })).toBeNull();
    expect(resolveWhen("  ", { now })).toBeNull();
  });
});

describe("resolveWhen shorthand and typos", () => {
  test.each([
    ["tomorow", "2026-10-24", null],
    ["thrusday morning", "2026-10-29", "09:00:00"],
    ["wednsday", "2026-10-28", null],
    ["3p", "2026-10-23", "15:00:00"],
    ["thu 9a", "2026-10-29", "09:00:00"],
    ["a week from tuesday", "2026-11-03", null],
    ["2 days after friday", "2026-10-25", null],
    ["day after tomorrow", "2026-10-25", null],
    ["week after next", "2026-11-06", null],
    ["end of quarter", "2026-12-31", null],
    ["eoq", "2026-12-31", null],
    ["end of q1", "2027-03-31", null],
    ["eoy", "2026-12-31", null],
    ["cob", "2026-10-23", null],
    ["close of business", "2026-10-23", null],
    ["mid november", "2026-11-15", null],
  ])("%p", (phrase, date, time) => {
    const when = resolveWhen(phrase, { now });
    expect(when?.date.toString()).toBe(date);
    expect(when?.time?.toString() ?? null).toBe(time);
  });
});

describe("resolveWhen holidays and clean-up", () => {
  test.each([
    ["thanksgiving", "2026-11-26"],
    ["new year's", "2027-01-01"],
    ["new years eve", "2026-12-31"],
    ["labor day", "2027-09-06"],
    ["memorial day", "2027-05-31"],
    ["easter", "2027-03-28"],
    ["halloween", "2026-10-31"],
    ["this summer", "2027-06-21"],
    ["november", "2026-11-01"],
    ["thu 10/29", "2026-10-29"],
    ["next_tue", "2026-10-27"],
    ["oct+28", "2026-10-28"],
    ["tmrw tmrw", "2026-10-24"],
    ["tomorrow through friday", "2026-10-24"],
    ["the fifteenth", "2026-11-15"],
    ["by the twenty-first", "2026-11-21"],
    ["later today", "2026-10-23"],
    ["quarter end", "2026-12-31"],
    ["this week", "2026-10-23"],
    ["the fifth of next month", "2026-11-05"],
    ["saturday's bridal trial", "2026-10-24"],
    ["viernes", "2026-10-23"],
    // Circumstances around the date are dropped.
    ["tues after breakfast", "2026-10-27"],
    ["friday's visit", "2026-10-23"],
    ["nov 2 after london open", "2026-11-02"],
    ["monday once the kiln's cool", "2026-10-26"],
  ])("%p", (phrase, date) => {
    expect(resolveWhen(phrase, { now })?.date.toString()).toBe(date);
  });
});
