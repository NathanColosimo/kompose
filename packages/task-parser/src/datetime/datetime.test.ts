import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { isClockOnly, resolveWhen } from "../when";

// Tuesday 27 Oct 2026, 11:30 in New York.
const now = Temporal.ZonedDateTime.from(
  "2026-10-27T11:30:00-04:00[America/New_York]"
);

function read(text: string, repeating = false) {
  const when = resolveWhen(text, { now, repeating });
  return when
    ? [
        when.date.toString(),
        when.time?.toString().slice(0, 5) ?? null,
        when.end ? when.end.toPlainTime().toString().slice(0, 5) : null,
      ]
    : null;
}

type Case = [text: string, date: string, time: string | null, end?: string];

describe("resolveWhen", () => {
  const cases: Case[] = [
    // Days and times
    ["tmrw 3", "2026-10-28", "15:00"],
    ["2moro @ noon", "2026-10-28", "12:00"],
    ["next tue morning", "2026-11-03", "09:00"],
    ["fri at 4:30", "2026-10-30", "16:30"],
    ["tuesday", "2026-10-27", null],
    ["next tuesday", "2026-11-03", null],
    ["friday after next", "2026-11-06", null],
    ["tuesday next week", "2026-11-03", null],
    ["wedensday eve", "2026-10-28", "18:00"],
    ["thrus nite", "2026-10-29", "20:00"],
    ["tdy @ 5", "2026-10-27", "17:00"],
    ["tonight", "2026-10-27", "20:00"],
    ["first thing tomorrow", "2026-10-28", "09:00"],
    ["this afternoon", "2026-10-27", "13:00"],
    ["tomorrow after lunch", "2026-10-28", "13:00"],
    // Dates
    ["nov 3", "2026-11-03", null],
    ["November third", "2026-11-03", null],
    ["11/28/2026", "2026-11-28", null],
    ["11.03.26", "2026-03-11", null],
    ["2026-11-14", "2026-11-14", null],
    ["26-Oct-2026 14:00", "2026-10-26", "14:00"],
    ["the 15th", "2026-11-15", null],
    ["the twenty-second of november", "2026-11-22", null],
    ["Wed 28 Oct 9am", "2026-10-28", "09:00"],
    ["the last day of october", "2026-10-31", null],
    ["first monday of next month", "2026-11-02", null],
    // Clock times
    ["noonish", "2026-10-27", "12:00"],
    ["4.30pm", "2026-10-27", "16:30"],
    ["8.30", "2026-10-28", "08:30"],
    ["15:30h", "2026-10-27", "15:30"],
    ["quarter to 5", "2026-10-27", "16:45"],
    ["half past 3", "2026-10-27", "15:30"],
    ["ten to midnight", "2026-10-27", "23:50"],
    ["nine forty five", "2026-10-28", "09:45"],
    ["at 1530", "2026-10-27", "15:30"],
    ["Mon 07:00", "2026-11-02", "07:00"],
    ["at 4", "2026-10-27", "16:00"],
    ["at 10", "2026-10-28", "10:00"],
    ["midnight", "2026-10-28", "00:00"],
    // Ranges
    ["2-3pm", "2026-10-27", "14:00", "15:00"],
    ["11-1pm", "2026-10-28", "11:00", "13:00"],
    ["7-8am friday", "2026-10-30", "07:00", "08:00"],
    ["from 9 till noon", "2026-10-28", "09:00", "12:00"],
    ["between 12 and 1:30", "2026-10-27", "12:00", "13:30"],
    // Offsets and periods
    ["in a fortnight", "2026-11-10", null],
    ["a week from friday", "2026-11-06", null],
    ["in 2 hours", "2026-10-27", "13:30"],
    ["in an hour and a half", "2026-10-27", "13:00"],
    ["the week after next", "2026-11-10", null],
    ["eod", "2026-10-27", null],
    ["close of business", "2026-10-27", null],
    ["end of month", "2026-10-31", null],
    ["this weekend", "2026-10-31", null],
    ["early next week", "2026-11-02", null],
    ["mid-december", "2026-12-15", null],
    ["end of Q1", "2027-03-31", null],
    ["quarter end", "2026-12-31", null],
    // Holidays
    ["christmas eve", "2026-12-24", null],
    ["Labor Day at 9am", "2027-09-06", "09:00"],
    ["labor day weekend", "2027-09-04", null],
    ["boxing day", "2026-12-26", null],
    // Time zones: abbreviations name the region, with its daylight saving.
    ["3pm PT", "2026-10-27", "18:00"],
    ["9am PST", "2026-10-27", "12:00"],
    ["noon ET tomorrow", "2026-10-28", "12:00"],
    // Other languages
    ["mañana a las 5", "2026-10-28", "17:00"],
    ["mañana a las 8 y media", "2026-10-28", "08:30"],
    ["demain 14h", "2026-10-28", "14:00"],
    ["am Freitag um 11", "2026-10-30", "11:00"],
    ["am Samstag um halb zehn", "2026-10-31", "09:30"],
    ["bis zum 3. November", "2026-11-03", null],
    ["明日 15時", "2026-10-28", "15:00"],
    ["来週の火曜日", "2026-11-03", null],
    ["domani alle 4", "2026-10-28", "16:00"],
  ];
  test.each(
    cases.map(([text, date, time, end]) => [text, date, time, end ?? null])
  )("%p", (text, date, time, end) => {
    expect(read(text)).toEqual([date, time, end]);
  });

  test.each([
    "later this week",
    "after lunch",
    "the first frost",
    "recital week",
    "bridal",
  ])("%p names no date", (text) => {
    expect(read(text)).toBeNull();
  });
});

describe("repeats", () => {
  test.each([
    [
      "every weekday at 9",
      "2026-10-28",
      { byDay: ["MO", "TU", "WE", "TH", "FR"], freq: "WEEKLY", interval: 1 },
    ],
    [
      "every other mon",
      "2026-11-02",
      { byDay: ["MO"], freq: "WEEKLY", interval: 2 },
    ],
    [
      "1st of every month",
      "2026-11-01",
      { byMonthDay: 1, freq: "MONTHLY", interval: 1 },
    ],
    ["every 3 days", "2026-10-27", { freq: "DAILY", interval: 3 }],
    [
      "mon wed fri 7am",
      "2026-10-28",
      { byDay: ["MO", "WE", "FR"], freq: "WEEKLY", interval: 1 },
    ],
    [
      "monthly on the 15th",
      "2026-11-15",
      { byMonthDay: 15, freq: "MONTHLY", interval: 1 },
    ],
    ["every year on mar 3", "2027-03-03", { freq: "YEARLY", interval: 1 }],
    [
      "every tue until dec",
      "2026-10-27",
      { byDay: ["TU"], freq: "WEEKLY", interval: 1, until: "2026-12-01" },
    ],
    [
      "every day for 2 weeks",
      "2026-10-27",
      { count: 14, freq: "DAILY", interval: 1 },
    ],
    [
      "every Sunday at 4 for the next 4 weeks",
      "2026-11-01",
      { byDay: ["SU"], count: 4, freq: "WEEKLY", interval: 1 },
    ],
    [
      "every sunday starting next week",
      "2026-11-08",
      { byDay: ["SU"], freq: "WEEKLY", interval: 1 },
    ],
    [
      "every evening this week",
      "2026-10-27",
      { freq: "DAILY", interval: 1, until: "2026-11-01" },
    ],
    ["q2 weeks", "2026-10-27", { byDay: ["TU"], freq: "WEEKLY", interval: 2 }],
    [
      "chaque lundi",
      "2026-11-02",
      { byDay: ["MO"], freq: "WEEKLY", interval: 1 },
    ],
    [
      "montag bis freitag",
      "2026-10-27",
      { byDay: ["MO", "TU", "WE", "TH", "FR"], freq: "WEEKLY", interval: 1 },
    ],
    ["毎晩 21時", "2026-10-27", { freq: "DAILY", interval: 1 }],
  ])("%p", (text, date, recurrence) => {
    const when = resolveWhen(text, { now, repeating: true });
    expect(when?.date.toString()).toBe(date);
    expect(when?.recurrence).toEqual(recurrence as never);
  });

  test.each([
    ["first business day of each month", "2026-11-02"],
    ["the first tuesday of each month", "2026-11-03"],
    ["every 2nd and 4th wednesday", "2026-10-28"],
    ["last day of each month at 11pm", "2026-10-31"],
  ])("%p keeps only its first date", (text, date) => {
    const when = resolveWhen(text, { now, repeating: true });
    expect(when?.date.toString()).toBe(date);
    expect(when?.recurrence).toBeNull();
  });
});

test("isClockOnly", () => {
  expect(isClockOnly("4pm")).toBe(true);
  expect(isClockOnly("17h")).toBe(true);
  expect(isClockOnly("half nine")).toBe(true);
  expect(isClockOnly("tomorrow 4pm")).toBe(false);
  expect(isClockOnly("the 28th")).toBe(false);
});
