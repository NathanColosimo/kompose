import { Temporal } from "temporal-polyfill";
import { lookup } from "./lexicon";

type DateRule = (year: number) => Temporal.PlainDate;

/** The `nth` (1-based; -1 = last) `weekday` (1 = Monday) of a month. */
export function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  nth: number
) {
  if (nth > 0) {
    const first = Temporal.PlainDate.from({ day: 1, month, year });
    return first.add({
      days: ((weekday - first.dayOfWeek + 7) % 7) + (nth - 1) * 7,
    });
  }
  const last = Temporal.PlainDate.from({ day: 1, month, year })
    .add({ months: 1 })
    .subtract({ days: 1 });
  return last.subtract({ days: (last.dayOfWeek - weekday + 7) % 7 });
}

/** Western Easter (anonymous Gregorian algorithm). */
function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Temporal.PlainDate.from({ day, month, year });
}

const fixed =
  (month: number, day: number): DateRule =>
  (year) =>
    Temporal.PlainDate.from({ day, month, year });

const thanksgiving: DateRule = (year) => nthWeekday(year, 11, 4, 4);
const laborDay: DateRule = (year) => nthWeekday(year, 9, 1, 1);
const mlkDay: DateRule = (year) => nthWeekday(year, 1, 1, 3);
const presidentsDay: DateRule = (year) => nthWeekday(year, 2, 1, 3);

/**
 * US holidays and season starts people use as dates, by their words (each
 * word may also be read with an "s": "mothers day", "new years").
 */
export const HOLIDAYS: Record<string, DateRule> = {
  autumn: fixed(9, 22),
  "black friday": (year) => thanksgiving(year).add({ days: 1 }),
  "boxing day": fixed(12, 26),
  "canada day": fixed(7, 1),
  christmas: fixed(12, 25),
  "cinco de may": fixed(5, 5),
  "columbus day": (year) => nthWeekday(year, 10, 1, 2),
  "cyber monday": (year) => thanksgiving(year).add({ days: 4 }),
  "earth day": fixed(4, 22),
  easter,
  "easter monday": (year) => easter(year).add({ days: 1 }),
  fall: fixed(9, 22),
  "father day": (year) => nthWeekday(year, 6, 7, 3),
  "good friday": (year) => easter(year).subtract({ days: 2 }),
  "groundhog day": fixed(2, 2),
  halloween: fixed(10, 31),
  "independence day": fixed(7, 4),
  juneteenth: fixed(6, 19),
  "labor day": laborDay,
  "labour day": laborDay,
  "martin luther king day": mlkDay,
  "martin luther king jr": mlkDay,
  "memorial day": (year) => nthWeekday(year, 5, 1, -1),
  mlk: mlkDay,
  "mother day": (year) => nthWeekday(year, 5, 7, 2),
  "new year": fixed(1, 1),
  nye: fixed(12, 31),
  "patrick day": fixed(3, 17),
  "president day": presidentsDay,
  spring: fixed(3, 20),
  summer: fixed(6, 21),
  "tax day": fixed(4, 15),
  thanksgiving,
  valentine: fixed(2, 14),
  "veteran day": fixed(11, 11),
  winter: fixed(12, 21),
  xmas: fixed(12, 25),
};

/**
 * A holiday's date by name, or its eve's (the day before): in `year` if
 * given, else the next one on or after `today`.
 */
export function holidayDate(
  name: string,
  eve: boolean,
  year: number | null,
  today: Temporal.PlainDate
) {
  const rule = lookup(HOLIDAYS, name);
  if (!rule) {
    return null;
  }
  const on = (year: number) =>
    eve ? rule(year).subtract({ days: 1 }) : rule(year);
  if (year !== null) {
    return on(year);
  }
  const thisYear = on(today.year);
  return Temporal.PlainDate.compare(thisYear, today) >= 0
    ? thisYear
    : on(today.year + 1);
}
