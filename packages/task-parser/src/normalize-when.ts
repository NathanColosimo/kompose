import { Temporal } from "temporal-polyfill";

/**
 * Rewrites for date phrases gpu-time misses: typos ("tomorow", "thrusday"),
 * compact times ("3p"), and shorthand ("cob", "eoy", "mid november").
 */
export function normalizeWhen(text: string) {
  let result = text;
  for (const [pattern, replacement] of TRANSLATIONS) {
    result = result.replace(pattern, replacement);
  }
  result = result.replace(WORD_PATTERN, (word) => correctTypo(word));
  for (const [pattern, replacement] of REWRITES) {
    result = result.replace(pattern, replacement as string);
  }
  result = result.replace(SHARED_MERIDIEM, sharedMeridiem);
  return result.replace(
    NUMERIC_DATE,
    (match, first: string, second: string) => {
      const [month, day] =
        Number(first) > 12 ? [second, first] : [first, second];
      const name = MONTH_ABBREVIATIONS[Number(month) - 1];
      return name && Number(day) <= 31 ? `${name} ${Number(day)}` : match;
    }
  );
}

/**
 * "2-3:30pm": the start shares the end's am/pm unless that would make the
 * range run backwards ("11-1pm" starts at 11am). gpu-time otherwise reads a
 * weekday before such a range as today.
 */
const SHARED_MERIDIEM =
  /\b(\d{1,2})(:\d{2})?\s*(-|–|to|till|until)\s*(\d{1,2})(:\d{2})?\s*([ap])m\b/gi;

function sharedMeridiem(
  _match: string,
  startHour: string,
  startMinutes: string | undefined,
  separator: string,
  endHour: string,
  endMinutes: string | undefined,
  meridiem: string
) {
  const start = Number(startHour) % 12;
  const end = Number(endHour) % 12;
  const flipped = meridiem.toLowerCase() === "p" ? "a" : "p";
  const startMeridiem = start > end ? flipped : meridiem;
  const join = separator.length > 1 ? ` ${separator} ` : separator;
  return `${startHour}${startMinutes ?? ""}${startMeridiem}m${join}${endHour}${endMinutes ?? ""}${meridiem}m`;
}

/** "10/29" without a year; gpu-time sometimes reads it as a month and year. */
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})\b(?!\/)/g;
const MONTH_ABBREVIATIONS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

const MONTH_NAMES = `${MONTHS}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec`;

const NUMBER_WORDS: Record<string, string> = {
  eight: "8",
  eleven: "11",
  five: "5",
  four: "4",
  nine: "9",
  one: "1",
  seven: "7",
  six: "6",
  ten: "10",
  three: "3",
  twelve: "12",
  two: "2",
};
const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
  "twenty-first",
  "twenty-second",
  "twenty-third",
  "twenty-fourth",
  "twenty-fifth",
  "twenty-sixth",
  "twenty-seventh",
  "twenty-eighth",
  "twenty-ninth",
  "thirtieth",
  "thirty-first",
];
const SUFFIXES: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
/** "fifteenth" → "15th"; longest first so "twenty-first" wins over "first". */
const ORDINAL_WORDS: Record<string, string> = Object.fromEntries(
  ORDINALS.map((word, index) => {
    const day = index + 1;
    const suffix =
      (day < 11 || day > 13 ? SUFFIXES[day % 10] : undefined) ?? "th";
    return [word, `${day}${suffix}`] as const;
  }).toReversed()
);

const HOUR_WORDS = Object.keys(NUMBER_WORDS).join("|");
const MINUTE_WORDS: Record<string, string> = {
  "forty five": "45",
  "forty-five": "45",
  fifteen: "15",
  "o'clock": "00",
  ten: "10",
  thirty: "30",
  twenty: "20",
};
const WEEKDAY_OR_DAY =
  "(?:mon|tue|wed|thu|fri|sat|sun)\\p{L}*\\.?|today|tomorrow|tmrw|tmr|tonight";

const REWRITES: [RegExp, string | ((...args: string[]) => string)][] = [
  // "tuesday's appointment" → "tuesday appointment".
  [new RegExp(`\\b(${WEEKDAY_OR_DAY})['\u2019]s\\b`, "giu"), "$1"],
  // Spelled-out clock times: "nine forty five", "four o'clock", "at six".
  [
    new RegExp(
      `\\b(${HOUR_WORDS})[ -](${Object.keys(MINUTE_WORDS).join("|")})\\b`,
      "gi"
    ),
    (_m: string, hour: string, minutes: string) =>
      `${NUMBER_WORDS[hour.toLowerCase()]}:${MINUTE_WORDS[minutes.toLowerCase()]}`,
  ],
  [
    new RegExp(
      `\\b(at|around|about|by|until|till|before|after|from|to)\\s+(${HOUR_WORDS})\\b(?!\\s*(?:days?|weeks?|months?|hours?|hrs?|minutes?|mins?|people|of))`,
      "gi"
    ),
    (_m: string, lead: string, hour: string) =>
      `${lead} ${NUMBER_WORDS[hour.toLowerCase()]}`,
  ],
  [
    new RegExp(`\\b(${HOUR_WORDS})\\s*([ap])\\.?m\\b\\.?`, "gi"),
    (_m: string, hour: string, meridiem: string) =>
      `${NUMBER_WORDS[hour.toLowerCase()]}${meridiem}m`,
  ],
  [/\b(\d{1,2}(?::\d{2})?)\s*(?:ish|o'clock)\b/gi, "$1"],
  // "sat morn", "tomorrow am", "thurs a.m." → that day's morning/afternoon.
  [/\bmorn\b/gi, "morning"],
  [new RegExp(`\\b(${WEEKDAY_OR_DAY})\\s+a\\.?m\\b\\.?`, "giu"), "$1 morning"],
  [
    new RegExp(`\\b(${WEEKDAY_OR_DAY})\\s+p\\.?m\\b\\.?`, "giu"),
    "$1 afternoon",
  ],
  // "5 tmrw", "12–2 tomorrow": the clock before the day.
  [
    new RegExp(
      `^(\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?)\\s*[-–]\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?)\\s+(${WEEKDAY_OR_DAY})$`,
      "iu"
    ),
    "$3 from $1 to $2",
  ],
  [
    new RegExp(
      `^(\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?)\\s+(${WEEKDAY_OR_DAY})$`,
      "iu"
    ),
    "$2 at $1",
  ],
  // "after 6" as a start is 6.
  [/\bafter (\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)(?=\s*$)/gi, "at $1"],
  // "six tonight", "1:50" on its own, "nov 4 eod".
  [
    new RegExp(
      `\\b(${HOUR_WORDS})(?=\\s+(?:tonight|today|tomorrow|this (?:morning|afternoon|evening)))`,
      "gi"
    ),
    (hour: string) => NUMBER_WORDS[hour.toLowerCase()] ?? hour,
  ],
  [/^(\d{1,2}:\d{2})$/, "at $1"],
  // A bare 13-31 can only be a day of the month ("antes del 30").
  [
    /^(1[3-9]|2\d|3[01])$/,
    (day: string) => {
      const n = Number(day);
      const suffix = (n < 11 || n > 13 ? SUFFIXES[n % 10] : undefined) ?? "th";
      return `the ${n}${suffix}`;
    },
  ],
  [/^(.*\d.*?)\s+eod$/i, "$1"],
  // Spoken years: "twenty twenty six".
  [
    /\btwenty twenty[- ](one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (_m: string, digit: string) => `202${NUMBER_WORDS[digit.toLowerCase()]}`,
  ],
  // "tonight" alone means the evening (20:00, like "night").
  [
    /^(?![\s\S]*(?:\d|noon|midnight))([\s\S]*\btonight\b[\s\S]*)$/i,
    "$1 at 8pm",
  ],
  // Sometime this week or month starts now.
  [/^(?:sometime |later )?this (?:week|month)$/i, "today"],
  // Separators people type instead of spaces ("next_tue", "oct+28").
  [/[_+]/g, " "],
  // Repeated words ("tmrw tmrw").
  [/\b(\p{L}+)(?:\s+\1\b)+/giu, "$1"],
  // A weekday in front of a numeric date ("thu 10/29").
  [/^(?:mon|tue|wed|thu|fri|sat|sun)\p{L}*,?\s+(?=\d{1,2}[/.]\d{1,2})/iu, ""],
  // A bare month means its first day ("november").
  [new RegExp(`^(${MONTH_NAMES})$`, "i"), "in $1"],
  [/\b(\d{1,2}(?::\d{2})?)\s?([ap])(?![a-z.])/gi, "$1$2m"],
  // "930am" → "9:30am".
  [/\b(\d{1,2})([0-5]\d)\s?([ap])\.?m\b/gi, "$1:$2$3m"],
  [/\beoy\b/gi, "end of year"],
  [/\b(cob|close of business|end of (the )?(business |work )?day)\b/gi, "eod"],
  [/(^|[^e]\s)day after tomorrow\b/gi, "$1the day after tomorrow"],
  [/^day after tomorrow\b/gi, "the day after tomorrow"],
  [new RegExp(`\\bmid[- ]?(${MONTHS})\\b`, "gi"), "$1 15"],
  [/\bmid[- ]?month\b/gi, "the 15th"],
  // A bare hour range after a day ("tuesday 2-4") reads as a date otherwise.
  [
    /\b((?:mon|tue|wed|thu|fri|sat|sun)\p{L}*|today|tomorrow|tmrw)\s+(\d{1,2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}(?::\d{2})?)\b(?![/.]|\s*[ap]\.?m)/giu,
    "$1 from $2 to $3",
  ],
  // Military "0630", "1545"; 20xx-23xx only after "at", since 2026 is a year.
  [
    /(?<![\d/:.-])(?:(?<=\bat\s)(2[0-3])|([01]\d))([0-5]\d)(?![\d/:.-])/g,
    (
      _m: string,
      late: string | undefined,
      early: string | undefined,
      minutes: string
    ) => `${late ?? early}:${minutes}`,
  ],
  // 24-hour "18h", "9h30" (but "in 2h" is an offset).
  [
    /(?<!\bin\s)\b([01]?\d|2[0-3])h(\d{2})?\b/gi,
    (_m: string, h: string, m?: string) => `${h}:${m ?? "00"}`,
  ],
  [/\bfirst thing(?: in the morning)?\b/gi, "morning"],
  [/\blater (today|tonight|this \w+)\b/gi, "$1"],
  // "friday nights at 9" is one friday night here (repeats are labelled R).
  [
    /\b((?:mon|tue|wed|thu|fri|sat|sun)\p{L}*)\s+(morning|afternoon|evening|night)s\b/giu,
    "$1 $2",
  ],
  // British "half nine" is 9:30.
  [
    /\bhalf (?:past )?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (_m: string, hour: string) =>
      `${NUMBER_WORDS[hour.toLowerCase()] ?? hour}:30`,
  ],
  [
    /\b(twenty|thirty)\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/gi,
    "$1-$2",
  ],
  // "october thirtieth" → "october 30th".
  [
    new RegExp(
      `\\b(${MONTH_NAMES})\\s+(${Object.keys(ORDINAL_WORDS).join("|")})\\b`,
      "gi"
    ),
    (_m: string, month: string, word: string) =>
      `${month} ${ORDINAL_WORDS[word.toLowerCase()] ?? word}`,
  ],
  // "the fifteenth" → "the 15th".
  [
    new RegExp(
      `\\b(the|on|by) (${Object.keys(ORDINAL_WORDS).join("|")})\\b(?! (?:mon|tue|wed|thu|fri|sat|sun|week|business|work|thing|time|day|of the week))`,
      "gi"
    ),
    (_m: string, lead: string, word: string) =>
      `${lead} ${ORDINAL_WORDS[word.toLowerCase()] ?? word}`,
  ],
  [/\b(the \d{1,2}(?:st|nd|rd|th)) next month\b/gi, "$1 of next month"],
  [/\b(?:at |around )?lunch(?:time)?\b/gi, "at noon"],
  [/\b(?:at |around )?(?:dinner|supper)(?:time)?\b/gi, "evening"],
];

/** Date words in other languages people mix in ("mañana a las 6"). */
const FOREIGN_WORDS: [string, string][] = [
  // Spanish (longest first: "pasado mañana" before "mañana")
  ["pasado ma[ñn]ana", "the day after tomorrow"],
  ["por la ma[ñn]ana", "morning"],
  ["por la tarde", "afternoon"],
  ["por la noche", "night"],
  ["esta tarde", "this afternoon"],
  ["esta noche", "tonight"],
  ["ma[ñn]ana", "tomorrow"],
  ["hoy", "today"],
  ["a las", "at"],
  ["lunes", "monday"],
  ["martes", "tuesday"],
  ["mi[ée]rcoles", "wednesday"],
  ["jueves", "thursday"],
  ["viernes", "friday"],
  ["s[áa]bado", "saturday"],
  ["domingo", "sunday"],
  // French
  ["apr[èe]s-demain", "the day after tomorrow"],
  ["aujourd['’]hui", "today"],
  ["ce soir", "tonight"],
  ["demain", "tomorrow"],
  ["apr[èe]s-midi", "afternoon"],
  ["matin", "morning"],
  ["soir", "evening"],
  ["lundi", "monday"],
  ["mardi", "tuesday"],
  ["mercredi", "wednesday"],
  ["jeudi", "thursday"],
  ["vendredi", "friday"],
  ["samedi", "saturday"],
  ["dimanche", "sunday"],
  // German
  ["heute abend", "tonight"],
  ["heute morgen", "this morning"],
  ["[üu]bermorgen", "the day after tomorrow"],
  ["heute", "today"],
  ["morgen fr[üu]h", "tomorrow morning"],
  ["morgen", "tomorrow"],
  ["abend", "evening"],
  ["montag", "monday"],
  ["dienstag", "tuesday"],
  ["mittwoch", "wednesday"],
  ["donnerstag", "thursday"],
  ["freitag", "friday"],
  ["samstag", "saturday"],
  ["sonntag", "sunday"],
  ["um", "at"],
  // Italian and Portuguese
  ["dopodomani", "the day after tomorrow"],
  ["stasera", "tonight"],
  ["domani", "tomorrow"],
  ["oggi", "today"],
  ["alle", "at"],
  ["amanh[ãa]", "tomorrow"],
  ["hoje", "today"],
];
/** Spanish clock hours, 1-12 ("a las cuatro"). */
const SPANISH_HOURS = [
  "una",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
];
const TRANSLATIONS: [RegExp, string][] = [
  ...SPANISH_HOURS.map((word, index): [RegExp, string] => [
    new RegExp(`(?<=\\b(?:a las|at)\\s+)${word}\\b`, "gi"),
    String(index + 1),
  ]),
  ...FOREIGN_WORDS.map(([words, english]): [RegExp, string] => [
    // "a las"/"um"/"alle" only before a number.
    ["a las", "um", "alle"].includes(words)
      ? new RegExp(
          `(?<![\\p{L}])${words}(?=\\s+(?:\\d|${SPANISH_HOURS.join("|")}))`,
          "giu"
        )
      : new RegExp(`(?<![\\p{L}])${words}(?![\\p{L}])`, "giu"),
    english,
  ]),
  // Japanese
  [/明後日/gu, " the day after tomorrow "],
  [/明日/gu, " tomorrow "],
  [/今日/gu, " today "],
  [/今夜|今晩/gu, " tonight "],
  [/朝/gu, " morning "],
  [/午後/gu, " afternoon "],
  [/夜/gu, " night "],
  [/の/gu, " "],
];

const DATE_VOCABULARY = new Set([
  "tmrw",
  "tmr",
  "tmw",
  "tmrow",
  "tom",
  "tdy",
  "tod",
  "nxt",
  "wk",
  "wks",
  "wknd",
  "mo",
  "mos",
  "hr",
  "hrs",
  "min",
  "eom",
  "eoy",
  "eoq",
  "am",
  "pm",
  "noon",
  "midnight",
  "eod",
  "eow",
  "cob",
  "days",
  "tonight",
  "today",
  "tomorrow",
  "at",
  "on",
  "by",
  "in",
  "of",
  "the",
  "a",
  "an",
  "and",
  "to",
  "thru",
  "through",
  "till",
  "year",
  "years",
  "hour",
  "hours",
  "minutes",
  "mins",
  "ago",
  "now",
  "christmas",
  "thanksgiving",
  "easter",
  "halloween",
  "eve",
  "summer",
  "winter",
  "spring",
  "fall",
  "autumn",
]);
const DAY_OR_MONTH_PREFIX = new RegExp(
  `^(?:mon|tue|wed|thu|fri|sat|sun|${MONTH_NAMES})`,
  "i"
);
const PLAIN_WORD = /^\p{L}[\p{L}'’-]*$/u;

/**
 * `text` without the plain non-date words at its end ("friday release" →
 * "friday"), or null when there are none to drop.
 */
export function withoutTrailingWords(text: string) {
  const words = text.split(" ");
  let keep = words.length;
  while (keep > 1) {
    const word = (words[keep - 1] ?? "").toLowerCase();
    if (
      !PLAIN_WORD.test(word) ||
      KNOWN.has(word) ||
      DATE_VOCABULARY.has(word) ||
      DAY_OR_MONTH_PREFIX.test(word)
    ) {
      break;
    }
    keep -= 1;
  }
  return keep < words.length ? words.slice(0, keep).join(" ") : null;
}

/** Words a date phrase is made of; misspellings are corrected toward them. */
const DATE_WORDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "tomorrow",
  "today",
  "tonight",
  "weekend",
  "weekday",
  "weekdays",
  "morning",
  "afternoon",
  "evening",
  "january",
  "february",
  "september",
  "october",
  "november",
  "december",
  "august",
];
const KNOWN = new Set([
  ...DATE_WORDS,
  ...MONTHS.split("|"),
  "next",
  "week",
  "weeks",
  "month",
  "months",
  "every",
  "other",
  "after",
  "before",
  "night",
  "noon",
  "midnight",
  "monthly",
  "weekly",
  "daily",
  "yearly",
  "quarter",
  "starting",
  "until",
  "from",
  "this",
  "coming",
  "end",
  "start",
  "beginning",
  "early",
  "late",
  "lunch",
  "mondays",
  "tuesdays",
  "wednesdays",
  "thursdays",
  "fridays",
  "saturdays",
  "sundays",
]);
const WORD_PATTERN = /\p{L}{4,}/gu;

function correctTypo(word: string) {
  const lower = word.toLowerCase();
  if (KNOWN.has(lower)) {
    return word;
  }
  const limit = lower.length <= 5 ? 1 : 2;
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const candidate of DATE_WORDS) {
    // Typos keep the first letter; otherwise "bridal" would become "friday".
    if (
      candidate[0] !== lower[0] ||
      Math.abs(candidate.length - lower.length) > limit
    ) {
      continue;
    }
    const distance = editDistance(lower, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ?? word;
}

/** Optimal string alignment distance (Levenshtein plus transpositions). */
function editDistance(a: string, b: string) {
  // rows[i][j]: distance between the first i chars of a and j chars of b.
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      if (i === 0) {
        row.push(j);
        continue;
      }
      const previous = rows[i - 1] ?? [];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
      row.push(distance);
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? 0;
}

const QUARTER_PATTERN =
  /^(?:by\s+)?(?:the\s+)?(?:end of (?:the |this )?(?:q([1-4])|quarter)|(?:q([1-4])|quarter|qtr) end|eoq)$/i;

/** The last day of a quarter for "end of quarter", "eoq", "end of q3". */
export function quarterEnd(text: string, today: Temporal.PlainDate) {
  const match = QUARTER_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  const named = match[1] ?? match[2];
  const quarter = named ? Number(named) : Math.ceil(today.month / 3);
  // Quarter ends (Mar 31, Jun 30, Sep 30, Dec 31) are the same every year.
  const end = Temporal.PlainDate.from({
    day: 1,
    month: quarter * 3,
    year: today.year,
  })
    .add({ months: 1 })
    .subtract({ days: 1 });
  return Temporal.PlainDate.compare(end, today) < 0
    ? end.add({ years: 1 })
    : end;
}

const OFFSET_PATTERN =
  /^(a|an|one|two|three|four|\d+)\s+(day|days|week|weeks)\s+(?:from|after)\s+(.+)$/i;
const WEEK_AFTER_NEXT_PATTERN = /^(the )?week after next$/i;
const COUNTS: Record<string, number> = {
  a: 1,
  an: 1,
  four: 4,
  one: 1,
  three: 3,
  two: 2,
};

/** "a week from tuesday" → ["tuesday", { days: 7 }]. */
export function offsetFrom(text: string) {
  if (WEEK_AFTER_NEXT_PATTERN.test(text.trim())) {
    return { anchor: "today", days: 14 };
  }
  const match = OFFSET_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  const count = COUNTS[(match[1] ?? "").toLowerCase()] ?? Number(match[1]);
  const days = (match[2] ?? "").toLowerCase().startsWith("week")
    ? count * 7
    : count;
  return { anchor: match[3] ?? "", days };
}
