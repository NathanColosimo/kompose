/**
 * Date phrase → tokens. Numeric dates and clock times become single
 * tokens; words are lowercased, translated, and corrected to canonical
 * English ("tmrw" → "tomorrow", "wedensday" → "wednesday").
 */
import {
  ALIASES,
  CORRECTABLE,
  GERMAN_HOURS,
  JAPANESE,
  lookup,
  MONTHS,
  NUMBER_WORDS,
  ORDINAL_WORDS,
  ROMANCE_HOURS,
  TRANSLATIONS,
} from "./lexicon";

export type Token =
  | { kind: "date"; day: number; month: number; year: number | null }
  | {
      kind: "time";
      hour: number;
      minute: number;
      /** "am"/"pm" as written, "24" for a 24-hour clock, null when bare. */
      meridiem: "am" | "pm" | "24" | null;
    }
  | { kind: "number"; value: number; digits: string; ordinal: boolean }
  | { kind: "word"; text: string }
  | { kind: "symbol"; text: string };

const TRANSLATION_PATTERNS = TRANSLATIONS.map(
  ([words, english]) =>
    [
      new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, "gu"),
      english,
    ] as const
);
const SPACES = /\s+/g;
const POSSESSIVE = /'s$/;
const LETTERS_ONLY = /^\p{L}+$/u;
const DIGIT_LED = /^\d/;
const GERMAN_HALF = new RegExp(
  `\\bhalb (\\d{1,2}|${Object.keys(GERMAN_HOURS).join("|")})\\b`,
  "gu"
);
/**
 * A Spanish, Italian, French, Portuguese or German hour word after the
 * word for "at" ("a las ocho", "alle otto", "um drei"), or before a Spanish
 * quarter or half ("ocho y media"). After English "at" only German ones:
 * "at once" is not 11:00.
 */
const FOREIGN_HOUR = new RegExp(
  `(?<![\\p{L}])((?:a las|a la|às|à|alle|um|at) |all')?(${[
    ...Object.keys(ROMANCE_HOURS),
    ...Object.keys(GERMAN_HOURS),
  ].join("|")})(?![\\p{L}])( y media| y cuarto| menos cuarto)?(?![\\p{L}])`,
  "gu"
);
/** 午後3時半, 3時5分, 15時: am/pm, the hour, then 半 (half) or minutes. */
const JAPANESE_CLOCK = /(午前|午後)?(\d{1,2})時(?:(半)|(\d{1,2})分)?/gu;
const JAPANESE_MERIDIEMS: Record<string, string> = { 午前: "am", 午後: "pm" };

/** Lowercase, other languages to English, curly quotes straightened. */
function normalizeText(text: string) {
  let result = ` ${text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\b([ap])\.m\b\.?/g, "$1m")
    .replace(/-ish\b/g, "ish")
    .replace(
      /\b(?:close of business|end of (?:the )?(?:business |work(?:ing)? )?day)\b/g,
      "eod"
    )
    // Separators typed instead of spaces: "oct+28", "next_tue".
    .replace(/(?<=[\p{L}\d])[+_](?=[\p{L}\d])/gu, " ")
    .replace(
      /\b(twenty|thirty)[- ](first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g,
      (_m, tens: string, unit: string) =>
        `${(tens === "twenty" ? 20 : 30) + (lookup(ORDINAL_WORDS, unit) ?? 0)}th`
    )} `;
  result = result.replace(
    JAPANESE_CLOCK,
    (_m, period: string | undefined, hour: string, half, minute = "0") => {
      // 午前/午後 only on a 12-hour clock: 午後15時 is 15:00.
      const meridiem =
        period && Number(hour) <= 12 ? JAPANESE_MERIDIEMS[period] : "";
      return ` ${hour}:${half ? "30" : minute.padStart(2, "0")}${meridiem} `;
    }
  );
  for (const [pattern, english] of JAPANESE) {
    result = result.replace(pattern, english);
  }
  // German "halb drei" is half past two.
  result = result.replace(GERMAN_HALF, (_m, hour: string) => {
    const value = GERMAN_HOURS[hour] ?? Number(hour);
    return ` ${value === 1 ? 12 : value - 1}:30 `;
  });
  // German compounds: "montagvormittag", "freitagmittag".
  result = result.replace(
    /(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(vormittag|nachmittag|abend|mittag|morgen|fr[üu]h)/gu,
    "$1 $2"
  );
  result = result.replace(/\bel d[íi]a (\d{1,2})\b/gu, "the $1th");
  result = result.replace(
    FOREIGN_HOUR,
    (match, lead: string | undefined, hour: string, fraction?: string) => {
      const german = lookup(GERMAN_HOURS, hour);
      const isHour = lead === "at " ? german !== undefined : Boolean(lead);
      if (!(isHour || fraction)) {
        return match;
      }
      return `${lead ?? ""}${german ?? lookup(ROMANCE_HOURS, hour)}${fraction ?? ""}`;
    }
  );
  // Spanish quarter and half hours: "a las 8 y media".
  result = result
    .replace(/(\d{1,2}) y media\b/gu, "$1:30")
    .replace(/(\d{1,2}) y cuarto\b/gu, "$1:15")
    .replace(
      /(\d{1,2}) menos cuarto\b/gu,
      (_m, hour: string) => `${Number(hour) === 1 ? 12 : Number(hour) - 1}:45`
    );
  for (const [pattern, english] of TRANSLATION_PATTERNS) {
    result = result.replace(pattern, english).replace(SPACES, " ");
  }
  // "montag bis freitag": a span of days.
  result = result.replace(
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday) by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gu,
    "$1 through $2"
  );
  return result.replace(SPACES, " ").trim();
}

const DIGIT_ALIASES = new RegExp(
  `(?:${Object.keys(ALIASES)
    .filter((alias) => DIGIT_LED.test(alias))
    .join("|")})(?![\\p{L}])`,
  "uy"
);
const MERIDIEM = String.raw`\s*(a|p)\.?(?:m\b\.?)?(?![\p{L}])(?!\s+(?:day|week|month|year|time|few|couple|bit)\b)`;
/** Token patterns, tried in order at each position. */
const LEXEMES: [RegExp, (match: RegExpExecArray) => Token | Token[] | null][] =
  [
    // "2moro", "2nite": aliases that start with a digit.
    [DIGIT_ALIASES, (m) => wordTokens(m[0])],
    // 2026-11-14, 2026/11/14
    [
      /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/y,
      (m) => dateToken(Number(m[3]), Number(m[2]), Number(m[1])),
    ],
    // 11/28/2026, 28.11.26, 11-28-2026: US month first unless impossible.
    [
      /(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?![\d:])/y,
      (m) => {
        const year = Number(m[4]) + ((m[4] ?? "").length === 2 ? 2000 : 0);
        const [first, second] = [Number(m[1]), Number(m[3])];
        // Dots are European, day first: "11.03.26" is 11 March.
        return first > 12 || (m[2] === "." && second <= 12)
          ? dateToken(first, second, year)
          : dateToken(second, first, year);
      },
    ],
    // 11/3; "3/11" stays month first.
    [
      /(\d{1,2})\/(\d{1,2})(?![\d/])/y,
      (m) => {
        const [first, second] = [Number(m[1]), Number(m[2])];
        return first > 12
          ? dateToken(first, second, null)
          : dateToken(second, first, null);
      },
    ],
    // European "3.11." with a closing dot.
    [
      /(\d{1,2})\.(\d{1,2})\.(?!\d)/y,
      (m) => dateToken(Number(m[1]), Number(m[2]), null),
    ],
    // 10:30, 4:30pm, 15:30h, 10:30:00; "07:00" is a 24-hour clock.
    [
      new RegExp(
        String.raw`(\d{1,2}):(\d{2})(?::\d{2})?(?:${MERIDIEM}|\s*(h)(?![\p{L}]))?`,
        "yu"
      ),
      (m) =>
        timeToken(
          Number(m[1]),
          Number(m[2]),
          m[3],
          m[4] === undefined && (m[1] ?? "").startsWith("0")
        ),
    ],
    // 4.30pm, 6.20p
    [
      new RegExp(String.raw`(\d{1,2})\.(\d{2})${MERIDIEM}`, "yu"),
      (m) => timeToken(Number(m[1]), Number(m[2]), m[3]),
    ],
    // 8.30, 2.15 (a clock: dates have a closing dot or a year)
    [
      /(\d{1,2})\.([0-5]\d)(?![\d.])/y,
      (m) =>
        Number(m[1]) <= 23 ? timeToken(Number(m[1]), Number(m[2])) : null,
    ],
    // 930am, 1130p
    [
      new RegExp(String.raw`(\d{1,2})(\d{2})${MERIDIEM}`, "yu"),
      (m) =>
        Number(m[2]) < 60 ? timeToken(Number(m[1]), Number(m[2]), m[3]) : null,
    ],
    // 4pm, 4 p.m., 4p
    [
      new RegExp(String.raw`(\d{1,2})${MERIDIEM}`, "yu"),
      (m) => timeToken(Number(m[1]), 0, m[2]),
    ],
    // 9h30, 14h (French); "2h" alone may be a duration, so only with minutes or 13+.
    [
      /(\d{1,2})h(\d{2})?(?![\p{L}\d])/uy,
      (m) =>
        m[2] !== undefined || Number(m[1]) >= 13
          ? timeToken(Number(m[1]), Number(m[2] ?? 0))
          : null,
    ],
    // 1st, 22nd, 3rd, 15th
    [
      /(\d{1,2})(?:st|nd|rd|th)(?![\p{L}])/uy,
      (m) => ({
        digits: m[1] ?? "",
        kind: "number",
        ordinal: true,
        value: Number(m[1]),
      }),
    ],
    [
      /\d+/y,
      (m) => ({
        digits: m[0],
        kind: "number",
        ordinal: false,
        value: Number(m[0]),
      }),
    ],
    [/[\p{L}][\p{L}\p{N}'\p{M}]*/uy, (m) => wordTokens(m[0])],
    [
      /[-–—/,:.+&@~()!?;]/y,
      (m) => ({ kind: "symbol", text: m[0] === "—" ? "–" : m[0] }),
    ],
  ];

function dateToken(
  day: number,
  month: number,
  year: number | null
): Token | null {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? { day, kind: "date", month, year }
    : null;
}

function timeToken(
  hour: number,
  minute: number,
  meridiem?: string,
  /** Written with a leading zero ("07:00"). */
  padded = false
): Token | null {
  if (minute > 59 || hour > 24) {
    return null;
  }
  if (meridiem) {
    return hour >= 1 && hour <= 12
      ? { hour, kind: "time", meridiem: meridiem === "a" ? "am" : "pm", minute }
      : null;
  }
  return {
    hour,
    kind: "time",
    // "7h30" still follows the 1-7 pm rule; "17h" is a 24-hour clock.
    meridiem: hour >= 13 || hour === 0 || padded ? "24" : null,
    minute,
  };
}

/** A word in canonical form, or several ("everyday" → "every day"). */
function wordTokens(raw: string): Token[] {
  const word = raw.replace(POSSESSIVE, "");
  const alias = lookup(ALIASES, raw) ?? lookup(ALIASES, word);
  const canonical = alias ?? correct(word);
  return canonical.split(" ").map((text): Token => ({ kind: "word", text }));
}

const KNOWN = new Set([
  ...Object.values(ALIASES),
  ...Object.keys(NUMBER_WORDS),
  ...Object.keys(ORDINAL_WORDS),
  ...CORRECTABLE,
  ...MONTHS,
]);

/** The nearest date word for a misspelling, or the word itself. */
function correct(word: string) {
  if (word.length < 4 || KNOWN.has(word) || !LETTERS_ONLY.test(word)) {
    return word;
  }
  const limit = word.length <= 5 ? 1 : 2;
  let best = word;
  let bestDistance = limit + 1;
  for (const candidate of [...CORRECTABLE, ...SHORTHANDS]) {
    // Typos keep the first letter; otherwise "bridal" would become "friday".
    if (
      candidate[0] !== word[0] ||
      Math.abs(candidate.length - word.length) > limit
    ) {
      continue;
    }
    const distance = editDistance(word, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return lookup(ALIASES, best) ?? best;
}

/** Aliases typos are also corrected toward ("thrus" → "thurs"). */
const SHORTHANDS = ["thurs", "tues", "weds", "tmrw", "tomorow"];

/** Optimal string alignment distance (Levenshtein plus transpositions). */
function editDistance(a: string, b: string) {
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

/** Tokens of a date phrase. Unreadable characters are skipped. */
export function tokenize(text: string): Token[] {
  const normalized = normalizeText(text);
  const tokens: Token[] = [];
  let index = 0;
  while (index < normalized.length) {
    if (normalized[index] === " ") {
      index += 1;
      continue;
    }
    let matched = false;
    for (const [pattern, build] of LEXEMES) {
      pattern.lastIndex = index;
      const match = pattern.exec(normalized);
      if (!match) {
        continue;
      }
      const token = build(match);
      if (!token) {
        continue;
      }
      tokens.push(...(Array.isArray(token) ? token : [token]));
      index += match[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      index += 1;
    }
  }
  return tokens;
}
