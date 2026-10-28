/**
 * Extra S/U/R/M phrases for the training-time phrase swap (model/augment.py).
 * A small grammar covers forms the generated data has few of (24-hour
 * times, time zones, compact "3p", odd durations); every phrase is kept only
 * if the resolvers understand it, so swapped examples stay resolvable.
 * Usage: bun gen/phrases.ts  → data/phrases.json
 */
import { writeFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { resolveFields, type TaskFields } from "../../src/fields";
import type { Label } from "../../src/spans";
import { pick, ROOT, rng } from "./common";

const random = rng(77);

const WEEKDAYS = [
  ["monday", "mon", "Mon", "Monday"],
  ["tuesday", "tue", "tues", "Tuesday"],
  ["wednesday", "wed", "weds", "Wednesday"],
  ["thursday", "thu", "thurs", "Thursday"],
  ["friday", "fri", "Friday", "FRI"],
  ["saturday", "sat", "Saturday"],
  ["sunday", "sun", "Sunday"],
];
const MONTHS = [
  ["january", "jan", "Jan"],
  ["february", "feb", "Feb"],
  ["march", "mar", "March"],
  ["april", "apr", "April"],
  ["may", "May"],
  ["june", "jun", "June"],
  ["july", "jul", "July"],
  ["august", "aug", "Aug"],
  ["september", "sept", "sep", "Sept"],
  ["october", "oct", "Oct"],
  ["november", "nov", "Nov"],
  ["december", "dec", "Dec"],
];
const MONTH_NAMES = MONTHS.map((names) => names[0] as string);
const SUFFIXES: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
const ORDINAL = (n: number) =>
  `${n}${(n < 11 || n > 13 ? SUFFIXES[n % 10] : undefined) ?? "th"}`;

function weekday() {
  return pick(random, pick(random, WEEKDAYS));
}
function day() {
  const month = Math.floor(random() * 12);
  const date = 1 + Math.floor(random() * 28);
  const name = pick(random, MONTHS[month] as string[]);
  return pick(random, [
    `${name} ${date}`,
    `${name} ${ORDINAL(date)}`,
    `${ORDINAL(date)} of ${name}`,
    `${date} ${name}`,
    `${month + 1}/${date}`,
    `the ${ORDINAL(date)}`,
    `2026-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`,
  ]);
}
function clock() {
  const hour = 1 + Math.floor(random() * 12);
  const minutes = pick(random, ["", ":00", ":15", ":30", ":45", ":10", ":20"]);
  const h24 = 6 + Math.floor(random() * 16);
  return pick(random, [
    `${hour}${minutes}${pick(random, ["am", "pm", " am", " pm", "AM", "PM", "p", "a", "pm"])}`,
    `${hour}${minutes}`,
    `${h24}:${pick(random, ["00", "15", "30", "45"])}`,
    `${String(h24).padStart(2, "0")}${pick(random, ["00", "30"])}`,
    `${h24}h`,
    pick(random, ["noon", "midnight", "lunch"]),
  ]);
}
function relative() {
  return pick(random, [
    "today",
    "tomorrow",
    "tmrw",
    "tmr",
    "tonight",
    "this evening",
    "this afternoon",
    "tomorrow morning",
    "tomorrow night",
    "first thing tomorrow",
    "the day after tomorrow",
    "this weekend",
    "next weekend",
    "next week",
    "this week",
    `next ${weekday()}`,
    `this ${weekday()}`,
    `this coming ${weekday()}`,
    `${weekday()} ${pick(random, ["morning", "afternoon", "evening", "night"])}`,
    `in ${pick(random, ["2", "3", "a few", "10", "two"])} ${pick(random, ["days", "weeks"])}`,
    `in ${pick(random, ["an hour", "2 hours", "30 min", "45 minutes", "90 mins", "2h"])}`,
    `a week from ${weekday()}`,
    "end of month",
    "end of the week",
    "eow",
    "eod",
    "cob",
    `eod ${weekday()}`,
    "next month",
    `next ${pick(random, MONTH_NAMES)}`,
    `early ${pick(random, MONTH_NAMES)}`,
    `mid ${pick(random, MONTH_NAMES)}`,
    "end of q4",
    "end of quarter",
    pick(random, [
      "christmas",
      "thanksgiving",
      "new year's eve",
      "halloween",
      "valentine's day",
    ]),
  ]);
}

function start() {
  const zone =
    random() < 0.08
      ? ` ${pick(random, ["ET", "PT", "PST", "EST", "CT", "UTC"])}`
      : "";
  const time = () => `${clock()}${zone}`;
  return pick(random, [
    weekday,
    day,
    relative,
    () => `${weekday()} ${time()}`,
    () => `${weekday()} at ${time()}`,
    () => `${relative()} at ${time()}`,
    () => `${time()} ${relative()}`,
    () => `${day()} at ${time()}`,
    () => `${day()} ${time()}`,
    () => `${time()} on ${weekday()}`,
    () =>
      `${weekday()} ${pick(random, ["2-3pm", "9-10am", "1-2:30pm", "10am-12pm", "3pm-5pm", "11-1pm", "9 to 11", "14:00-15:30"])}`,
    () =>
      `${relative()} from ${pick(random, ["2 to 4", "9 to 10", "1 to 3pm", "10 to noon"])}`,
  ])();
}
function due() {
  return pick(random, [
    weekday,
    day,
    relative,
    () => `${weekday()} ${clock()}`,
    () => `${day()} ${clock()}`,
    () => `${weekday()} at ${clock()}`,
    () => `${clock()} ${weekday()}`,
    () => `${relative()} ${clock()}`,
  ])();
}
function repeat() {
  const days = WEEKDAYS.map((names) => names[0] ?? "");
  const at = random() < 0.4 ? ` at ${clock()}` : "";
  return pick(random, [
    () => `every ${weekday()}${at}`,
    () => `every other ${weekday()}${at}`,
    () =>
      `every ${pick(random, ["day", "weekday", "week", "month", "year", "morning", "evening"])}${at}`,
    () =>
      `${pick(random, ["daily", "weekly", "monthly", "yearly", "annually", "biweekly", "nightly", "quarterly", "fortnightly"])}${at}`,
    () =>
      `every ${pick(random, ["2", "3", "two", "4"])} ${pick(random, ["days", "weeks", "months"])}${at}`,
    () => `every ${pick(random, days)} and ${pick(random, days)}${at}`,
    () =>
      `${pick(random, ["mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays", "sundays"])}${at}`,
    () =>
      `on ${pick(random, ["mondays", "tuesdays", "thursdays", "fridays"])}${at}`,
    () => `the ${ORDINAL(1 + Math.floor(random() * 28))} of every month`,
    () => `monthly on the ${ORDINAL(1 + Math.floor(random() * 28))}`,
    () => `every month on the ${ORDINAL(1 + Math.floor(random() * 28))}`,
    () => `every year on ${day()}`,
    () =>
      `every day for ${pick(random, ["2 weeks", "a week", "10 days", "a month"])}`,
    () => `daily until ${pick(random, [day(), weekday(), "end of month"])}`,
    () => `every ${weekday()} until ${day()}`,
    () =>
      `weekly ${pick(random, ["5 times", "for 6 weeks", "through december"])}`,
    () => `mwf${at}`,
    () => `m-f${at}`,
    () => `every weekday${at}`,
  ])();
}
function duration() {
  return pick(random, [
    () =>
      `${pick(random, [5, 10, 15, 20, 25, 30, 40, 45, 60, 75, 90, 120])} ${pick(random, ["min", "mins", "minutes", "m", "minute"])}`,
    () =>
      `${pick(random, [5, 10, 15, 20, 25, 30, 45, 90])}${pick(random, ["m", "min", "mins", "'"])}`,
    () =>
      `${pick(random, [1, 2, 3, 4, 1.5, 2.5, 0.5])}${pick(random, ["h", "hr", "hrs", " hours", " hour", " h"])}`,
    () =>
      pick(random, ["1h30", "1h15", "2h30m", "1h45m", "1:30", "0:45", "2:00"]),
    () =>
      pick(random, [
        "an hour",
        "half an hour",
        "an hour and a half",
        "a couple hours",
        "a few hours",
        "a quarter hour",
        "half hour",
        "a few minutes",
        "two hours",
        "twenty minutes",
        "forty-five minutes",
        "ninety minutes",
        "fifteen mins",
        "1-2 hours",
        "30-45 min",
        "a half day",
        "half a day",
      ]),
  ])();
}

const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);
const TARGET = 3000;

/** Resolve "task <phrase>" with the phrase as one `label` span. */
function fieldsFor(label: Label, phrase: string) {
  return resolveFields({
    now,
    spans: [
      { end: 4, label: "T", start: 0, text: "task" },
      { end: 5 + phrase.length, label, start: 5, text: phrase },
    ],
    tagNames: [],
  });
}

/** Up to TARGET distinct phrases from `make` that resolve to `field`. */
function fill(label: Label, make: () => string, field: keyof TaskFields) {
  const seen = new Set<string>();
  for (
    let attempt = 0;
    attempt < TARGET * 4 && seen.size < TARGET;
    attempt += 1
  ) {
    const phrase = make();
    if (!seen.has(phrase) && fieldsFor(label, phrase)[field] !== null) {
      seen.add(phrase);
    }
  }
  console.log(label, seen.size);
  return [...seen];
}

const S = fill("S", start, "startDate");
const U = fill("U", due, "dueDate");
const R = fill("R", repeat, "recurrence");
const M = fill("M", duration, "durationMinutes");
await writeFile(`${ROOT}data/phrases.json`, JSON.stringify({ M, R, S, U }));
