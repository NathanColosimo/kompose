import { Temporal } from "temporal-polyfill";

type DateRule = (year: number) => Temporal.PlainDate;

/** The `nth` (1-based; -1 = last) `weekday` (1 = Monday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, nth: number) {
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

const CURLY_APOSTROPHE = /’/g;

/** US holidays and season starts people use as dates. */
const RULES: [RegExp, DateRule][] = [
  [/^thanksgiving( day)?$/, (year) => nthWeekday(year, 11, 4, 4)],
  [/^(new year'?s?|new year'?s day)$/, fixed(1, 1)],
  [/^new year'?s eve$/, fixed(12, 31)],
  [/^(labor|labour) day( weekend)?$/, (year) => nthWeekday(year, 9, 1, 1)],
  [/^memorial day( weekend)?$/, (year) => nthWeekday(year, 5, 1, -1)],
  [
    /^(the )?(4th|fourth) of july|july (4th|fourth)|independence day$/,
    fixed(7, 4),
  ],
  [/^halloween$/, fixed(10, 31)],
  [/^valentine'?s( day)?$/, fixed(2, 14)],
  [/^mother'?s day$/, (year) => nthWeekday(year, 5, 7, 2)],
  [/^father'?s day$/, (year) => nthWeekday(year, 6, 7, 3)],
  [/^easter( sunday)?$/, easter],
  [
    /^(mlk|martin luther king( jr\.?)?) day$/,
    (year) => nthWeekday(year, 1, 1, 3),
  ],
  [/^presidents'? day$/, (year) => nthWeekday(year, 2, 1, 3)],
  [/^(this |next )?spring$/, fixed(3, 20)],
  [/^(this |next )?summer$/, fixed(6, 21)],
  [/^(this |next )?(fall|autumn)$/, fixed(9, 22)],
  [/^(this |next )?winter$/, fixed(12, 21)],
];

/** The next date (on or after `today`) of a named holiday or season. */
export function holidayDate(text: string, today: Temporal.PlainDate) {
  const phrase = text.trim().toLowerCase().replace(CURLY_APOSTROPHE, "'");
  for (const [pattern, rule] of RULES) {
    if (!pattern.test(phrase)) {
      continue;
    }
    const thisYear = rule(today.year);
    return Temporal.PlainDate.compare(thisYear, today) >= 0
      ? thisYear
      : rule(today.year + 1);
  }
  return null;
}
