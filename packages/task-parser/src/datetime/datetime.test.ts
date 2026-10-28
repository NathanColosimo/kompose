import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { isClockOnly, resolveWhen } from "../when";

const zoned = (text: string) => Temporal.ZonedDateTime.from(text);
// Tuesday 27 Oct 2026, 11:30 in New York.
const now = zoned("2026-10-27T11:30:00-04:00[America/New_York]");
// Friday 23 Oct 2026, 10:00 in New York.
const friday = zoned("2026-10-23T10:00:00-04:00[America/New_York]");

function read(text: string, at = now) {
  const when = resolveWhen(text, { now: at });
  return when
    ? [
        when.date.toString(),
        when.time?.toString().slice(0, 5) ?? null,
        when.end ? when.end.toPlainTime().toString().slice(0, 5) : null,
      ]
    : null;
}

type Case = [text: string, date: string, time: string | null, end?: string];
const rows = (cases: Case[]) =>
  cases.map(
    ([text, date, time, end]): [
      string,
      string,
      string | null,
      string | null,
    ] => [text, date, time, end ?? null]
  );

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
    ["再来週", "2026-11-10", null],
    ["domani alle 4", "2026-10-28", "16:00"],
    ["alle otto", "2026-10-28", "08:00"],
    ["a las ocho y media", "2026-10-28", "08:30"],
    ["ocho y cuarto", "2026-10-28", "08:15"],
    ["a las nueve menos cuarto", "2026-10-28", "08:45"],
    ["午後3時半", "2026-10-27", "15:30"],
    ["午後3時30分", "2026-10-27", "15:30"],
    ["3時5分", "2026-10-27", "15:05"],
    ["午後15時", "2026-10-27", "15:00"],
    // Words on Object.prototype are just words.
    ["tomorrow constructor", "2026-10-28", null],
    ["__proto__ friday", "2026-10-30", null],
    // The next leap day.
    ["feb 29", "2028-02-29", null],
  ];
  test.each(rows(cases))("%p", (text, date, time, end) => {
    expect(read(text)).toEqual([date, time, end]);
  });

  // Friday 23 Oct, 10:00.
  const fridayCases: Case[] = [
    ["tomorrow", "2026-10-24", null],
    ["tmr", "2026-10-24", null],
    ["tomorrow at 4am", "2026-10-24", "04:00"],
    ["next tue 3pm", "2026-10-27", "15:00"],
    ["noon tmrw", "2026-10-24", "12:00"],
    ["in 45 minutes", "2026-10-23", "10:45"],
    ["in 2h", "2026-10-23", "12:00"],
    ["nov 1", "2026-11-01", null],
    ["on the 1st", "2026-11-01", null],
    ["weds", "2026-10-28", null],
    ["thu 10/29", "2026-10-29", null],
    ["nov 3 2026", "2026-11-03", null],
    ["Nov 2, 10:00", "2026-11-02", "10:00"],
    ["saturday morning, nov 1", "2026-11-01", "09:00"],
    ["sat morn", "2026-10-24", "09:00"],
    ["sat morning", "2026-10-24", "09:00"],
    ["thurs a.m.", "2026-10-29", "09:00"],
    ["friday nights at 9", "2026-10-23", "21:00"],
    ["tomorrow at lunch", "2026-10-24", "12:00"],
    ["tuesday's 11am appointment", "2026-10-27", "11:00"],
    ["every weekday at 9:30", "2026-10-26", "09:30"],
    // Clock times
    ["18h", "2026-10-23", "18:00"],
    ["9h30 tomorrow", "2026-10-24", "09:30"],
    ["tomorrow half nine", "2026-10-24", "09:30"],
    ["11/3 0630", "2026-11-03", "06:30"],
    ["tomorrow 1545", "2026-10-24", "15:45"],
    ["at 2130", "2026-10-23", "21:30"],
    ["tonight about eight", "2026-10-23", "20:00"],
    ["tmrw 4ish", "2026-10-24", "16:00"],
    ["wednesday around four", "2026-10-28", "16:00"],
    ["thursday at nine forty five", "2026-10-29", "09:45"],
    ["10/23 after 6", "2026-10-23", "18:00"],
    // A bare hour 1-7 is in the afternoon; 8-11 in the morning.
    ["4:30", "2026-10-23", "16:30"],
    ["5 tmrw", "2026-10-24", "17:00"],
    ["tomorrow at 4", "2026-10-24", "16:00"],
    ["in 2 days at 4", "2026-10-25", "16:00"],
    ["tomorrow at 9:30", "2026-10-24", "09:30"],
    // Ranges
    ["3pm-5pm thursday", "2026-10-29", "15:00", "17:00"],
    ["tuesday 2-3:30pm", "2026-10-27", "14:00", "15:30"],
    ["tue 2-4", "2026-10-27", "14:00", "16:00"],
    ["thu 9-10am", "2026-10-29", "09:00", "10:00"],
    ["11-1pm fri", "2026-10-23", "11:00", "13:00"],
    ["12–2 tomorrow", "2026-10-24", "12:00", "14:00"],
    ["from 3 to 5", "2026-10-23", "15:00", "17:00"],
    // Zones
    ["3pm ET", "2026-10-23", "15:00"],
    ["14:00 UTC", "2026-10-23", "10:00"],
    // Other languages
    ["mañana a las 6", "2026-10-24", "18:00"],
    ["mañana a las cuatro", "2026-10-24", "16:00"],
    ["demain matin", "2026-10-24", "09:00"],
    ["明日の朝", "2026-10-24", "09:00"],
    ["viernes", "2026-10-23", null],
    // Shorthand and typos
    ["tomorow", "2026-10-24", null],
    ["thrusday morning", "2026-10-29", "09:00"],
    ["wednsday", "2026-10-28", null],
    ["3p", "2026-10-23", "15:00"],
    ["thu 9a", "2026-10-29", "09:00"],
    ["next_tue", "2026-10-27", null],
    ["oct+28", "2026-10-28", null],
    ["tmrw tmrw", "2026-10-24", null],
    // Offsets and periods
    ["a week from tuesday", "2026-11-03", null],
    ["2 days after friday", "2026-10-25", null],
    ["day after tomorrow", "2026-10-25", null],
    ["week after next", "2026-11-06", null],
    ["end of quarter", "2026-12-31", null],
    ["eoq", "2026-12-31", null],
    ["eoy", "2026-12-31", null],
    ["cob", "2026-10-23", null],
    ["mid november", "2026-11-15", null],
    ["november", "2026-11-01", null],
    ["this summer", "2027-06-21", null],
    ["this week", "2026-10-23", null],
    ["later today", "2026-10-23", null],
    ["tomorrow through friday", "2026-10-24", null],
    ["the fifteenth", "2026-11-15", null],
    ["by the twenty-first", "2026-11-21", null],
    ["the fifth of next month", "2026-11-05", null],
    // Holidays
    ["thanksgiving", "2026-11-26", null],
    ["new year's", "2027-01-01", null],
    ["new years eve", "2026-12-31", null],
    ["labor day", "2027-09-06", null],
    ["memorial day", "2027-05-31", null],
    ["easter", "2027-03-28", null],
    ["halloween", "2026-10-31", null],
    // Circumstances around the date are dropped.
    ["saturday's bridal trial", "2026-10-24", null],
    ["tues after breakfast", "2026-10-27", null],
    ["friday's visit", "2026-10-23", null],
    ["nov 2 after london open", "2026-11-02", null],
    ["monday once the kiln's cool", "2026-10-26", null],
  ];
  test.each(rows(fridayCases))("%p on a Friday", (text, date, time, end) => {
    expect(read(text, friday)).toEqual([date, time, end]);
  });

  test.each([
    // "In 1 hour" is elapsed time across a daylight saving change.
    [
      "2026-03-08T01:30:00-05:00[America/New_York]",
      "in 1 hour",
      "2026-03-08",
      "03:30",
    ],
    [
      "2026-11-01T01:30:00-04:00[America/New_York]",
      "in 1 hour",
      "2026-11-01",
      "01:30",
    ],
    // After February in a leap year, the next leap day is 4 years on.
    ["2028-03-05T10:00:00+01:00[Europe/Berlin]", "feb 29", "2032-02-29", null],
  ])("at %p, %p", (at, text, date, time) => {
    expect(read(text, zoned(at))).toEqual([date, time, null]);
  });

  test.each([
    "later this week",
    "after lunch",
    "the first frost",
    "recital week",
    "bridal",
    "groceries",
    "  ",
    "constructor",
    "at once",
    "feb 30",
    "feb 29 2027",
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
    // "for" counts occurrences, not days.
    [
      "every week for 3 weeks",
      "2026-10-27",
      { byDay: ["TU"], count: 3, freq: "WEEKLY", interval: 1 },
    ],
    [
      "monthly for 3 months",
      "2026-10-27",
      { byMonthDay: 27, count: 3, freq: "MONTHLY", interval: 1 },
    ],
    [
      "yearly for 3 years",
      "2026-10-27",
      { count: 3, freq: "YEARLY", interval: 1 },
    ],
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

test.each([
  ["4pm", true],
  ["17h", true],
  ["half nine", true],
  ["tomorrow 4pm", false],
  ["the 28th", false],
])("isClockOnly(%p) is %p", (text, clockOnly) => {
  expect(isClockOnly(text)).toBe(clockOnly);
});
