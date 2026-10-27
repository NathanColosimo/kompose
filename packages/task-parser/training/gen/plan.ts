/**
 * Slot plans for generation. Each slot asks for one example with a given tag
 * list, persona, style, labels and twist, so coverage is controlled by code
 * rather than by whatever the generator likes to write.
 */
export interface Persona {
  description: string;
  writingHabits: string;
}

export interface Slot {
  labels: string[];
  persona: Persona;
  style: string;
  tagMode: string;
  tags: string[];
  twist: string | null;
}

export const STYLES = [
  "terse, all lowercase, no punctuation",
  "normal sentence case with punctuation",
  "voice dictation: one run-on sentence, spoken filler (um, so, like), numbers and times spelled out in words (three thirty, twenty minutes)",
  "texting abbreviations (tmrw, tmr, wk, mins, hr, w/, b4, pls, thx, abt)",
  "one or two realistic typos, possibly inside date words (tomorow, wednsday, thrusday)",
  "date or time first, then the task",
  "some words in ALL CAPS for emphasis",
  "includes an emoji or two",
  "TODO-list style with a prefix like 'todo:' or '- [ ]' (no square brackets though; use '- ' or 'todo:')",
  "brain dump: two or three short sentences rambling toward one task",
  "formal and professional",
  "fragment pasted from Slack or email, with a link",
  "long and detailed: extra details belong in the description",
  "just a short title, almost nothing else",
  "power user: compact times like 3p, 9a, 1530, 17:00, and hashtags",
  "details in parentheses, like (30 min) or (due fri) or (work)",
  "phrased as a request: 'can you remind me to ...' or 'add a task to ...'",
  "casual with slang",
  "comma-separated chunks: task, when, how long, notes",
  "starts with a context prefix ('re: launch', 'Fwd:', 'Slack:', or one of the user's tags followed by a colon), then the task",
  "pasted from a notes app: a title line, then a line break and a note line or two",
  "non-native English speaker: slightly unusual word order or prepositions, still clear",
  "one or two words from another language mixed in (Spanish, French, German, Hindi, Portuguese...), the rest English",
  "abbreviated weekdays and months (thu, thurs, tues, wed, sept, dec, jan)",
  "24-hour clock times (14:30, 0900, 18h)",
  "markdown-ish: **bold**, `code names`, or a leading '* ' bullet",
  "phrased as a question to self ('should i call the bank tomorrow?')",
  "extremely short: two to four words, e.g. a noun plus a time",
  "a 40-70 word ramble where the actual task and its details must be untangled",
  "no spaces after commas and sloppy punctuation (call bob,tmrw,30m)",
  "mobile autocorrect artifacts (a wrong but real word, a capitalized random word, a missing apostrophe)",
  "dense: one packed line with the task, when, a deadline, how long, a tag and a note, separated by commas, slashes or dashes",
  "a forwarded or copied message with the user's own short instruction around it",
  "numbered steps or a mini checklist after the task (1) ... 2) ...), which belong in the description",
  "written to an assistant in full polite sentences, with the details spread over two or three sentences",
];

export const TWISTS = [
  "the title contains a word that looks like a date or weekday but is not one (a name like May or June, a show like Friday Night Lights, a book like 1984, 'march' as a verb, a band)",
  "the title contains a number that is not a duration or date (room 204, 3 boxes, v2.1, 401k, 5k run, 2 tickets)",
  "the title contains a duration-like phrase that belongs to the thing itself (buy a 2 hour parking pass, book a 30 min call slot, 10 minute abs video) while the real duration is separate or absent",
  "the task has both a start and a separate deadline",
  "a recurring task with a separate start (every monday starting next week)",
  "a recurring task whose deadline is inside each cycle (pay rent every month by the 1st)",
  "a time range for the start (3-5pm thursday, from 2 to 4 tomorrow)",
  "a vague time that must stay unlabelled (later, soon, asap, sometime, after lunch, when i get a chance)",
  "a word that equals one of the user's tag names is used as an ordinary word in the title, not as a tag",
  "a hashtag or category that is NOT in the user's tag list",
  "the description runs on without punctuation after the title",
  "filler words in the middle of the sentence, not only at the start",
  "several people or place names",
  "a relative compound date (a week from tuesday, 3 days after friday, 2 weeks from now, the day after tomorrow)",
  "a holiday or season reference (before christmas, by thanksgiving, this summer)",
  "plural weekdays meaning repetition (on mondays, tuesdays and thursdays)",
  "the title is interrupted by the date (call tomorrow the dentist)",
  "time words inside the description that are not the task's start (call bob, he said he's free after 5 most days)",
  "a bare hour without am/pm (at 4, around 9)",
  "an exact date in a numeric format (11/3, 2026-11-03, nov 3rd, 3rd of november)",
  "end-of-period deadlines (eod, eow, end of month, end of quarter, by close of business)",
  "a link where the title must come from words around it",
  "a correction in the text (not tomorrow, friday; actually make it 3pm); only the final value is labelled, the replaced one stays unlabelled",
  "a timezone after the time (3pm ET, 9am PST, 14:00 UTC); the timezone is part of the S span",
  "only an ordinal day of the month (the 15th, on the 3rd, by the 30th)",
  "this vs next (this friday, next friday, this coming monday, next weekend, this weekend)",
  "a day part instead of a clock time (tonight, this evening, first thing tomorrow, tomorrow at lunch, noon, midnight)",
  "an unusual duration form (45', 1.5h, 90m, quick 5 min, half a day, a few minutes)",
  "a repeat that ends (every day until friday, daily for 3 weeks, 10 times, weekly through december)",
  "a repeat with an interval (every 2 weeks, every 3 days, biweekly, every other month, every 6 months)",
  "a yearly repeat (every year on march 3, annually on the 1st of june, every jan 15)",
  "a vague deadline relative to an event (before the meeting, after the kids are asleep) that stays unlabelled",
  "a past date used as context inside the title or description (yesterday's email, last week's notes), not as S or U",
  "a date far ahead (next march, in 6 months, june 2027, early next year)",
  "the user's tag is written with different case, spacing or without its emoji (list has '💼 Clients', text says 'clients')",
  "two hashtags, one matching a tag in the list and one not in the list",
  "an address, phone number or order number in the description",
  "the task is a single noun phrase with no verb (dentist tmrw 3pm, groceries, q3 report by fri)",
  "a start time with no date (at 3, at 4:30pm, around noon) next to other details",
  "words like 'today', 'tonight' or 'now' that are filler or part of a quote, not the start ('the today show', 'call now tv')",
  "the duration comes first (30 min: review the deck), or is in a block like '[1h]' written as '(1h)'",
  "start and end of a block both given (from 9 to 11 tomorrow, tue 2-3:30pm), so the S span covers the range and no M",
  "when to work on it and when it is due are both given in casual words (do it sunday night, due monday 9am; work on it tue, they need it by thu)",
  "the reason or purpose follows the action ('to confirm the dates', 'so she has it before friday'); decide carefully whether it is part of the title",
  "the person or place the task is about is in parentheses or after a dash (call the bank (Chase), email Priya - legal)",
  "a weekday or date inside the description that is context, not the task's start or deadline (she got it Tuesday, the event is on the 30th)",
];

/** label → probability that the slot requires it */
const LABEL_RATES: Record<string, number> = {
  D: 0.45,
  F: 0.35,
  G: 0.14,
  L: 0.12,
  M: 0.35,
  R: 0.15,
  S: 0.52,
  U: 0.26,
};

const TAG_MODES = [
  [
    "explicit: pick one tag from this list and write the input so it names that tag (as a hashtag, a label like 'work:', or in parentheses); list that tag",
    0.2,
  ],
  [
    "implied: pick one tag from this list and write a task whose content clearly belongs to it without naming it; list that tag",
    0.32,
  ],
  [
    "none: write a task that has nothing to do with any tag in this list; list no tags",
    0.3,
  ],
  [
    "tricky: write a task that shares a word or theme with one tag but that a careful human would NOT file under it; list no tags",
    0.1,
  ],
  [
    "two: pick two tags from this list and write a task that clearly belongs to both; list both",
    0.08,
  ],
] as const;

/**
 * Broad category tags many people use. Slots with these lists teach tags
 * implied by meaning alone ("call mom" → Family, "standup" → Work), which
 * topical tag lists rarely need.
 */
const GENERIC_TAGS = [
  "Work",
  "Home",
  "Family",
  "Health",
  "Finance",
  "Errands",
  "Personal",
  "Travel",
  "Car",
  "Career",
  "Clients",
  "Shopping",
  "Kids",
  "School",
  "Fitness",
  "Social",
  "Admin",
  "Pets",
  "Garden",
  "Side project",
  "Learning",
  "Bills",
  "Friends",
  "Church",
  "Volunteering",
  "Hobbies",
  "Meetings",
  "Self-care",
  "Groceries",
  "House",
];
const EMOJI: Record<string, string> = {
  Car: "🚗",
  Family: "👪",
  Finance: "💰",
  Fitness: "🏋️",
  Health: "🩺",
  Home: "🏠",
  Pets: "🐾",
  Travel: "✈️",
  Work: "💼",
};
const GENERIC_MODES = [
  [
    "implied by meaning: pick one tag from this list that the task clearly belongs to even though the text shares no word with the tag name (call mom → Family, standup → Work, dry cleaning → Errands); list that tag",
    0.5,
  ],
  ["none: write a task that fits none of these tags; list no tags", 0.2],
  [
    "ambiguous: write a task that could plausibly fit two of these tags but clearly fits neither better; list no tags",
    0.1,
  ],
  [
    "explicit: pick one tag from this list and write the input so it names that tag; list that tag",
    0.1,
  ],
  [
    "two: pick two tags from this list and write a task that clearly belongs to both; list both",
    0.1,
  ],
] as const;

function genericTags(random: () => number) {
  const count = 2 + Math.floor(random() * 6);
  const emoji = random() < 0.25;
  return shuffled(random, GENERIC_TAGS)
    .slice(0, count)
    .map((tag) => (emoji && EMOJI[tag] ? `${EMOJI[tag]} ${tag}` : tag));
}

function pickMode(
  random: () => number,
  modes: readonly (readonly [string, number])[]
) {
  let roll = random();
  for (const [mode, rate] of modes) {
    roll -= rate;
    if (roll < 0) {
      return mode;
    }
  }
  return modes[0]?.[0] ?? "";
}

/** Mulberry32: small seeded PRNG so plans are reproducible. */
export function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function shuffled<T>(random: () => number, items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

/**
 * "weak" oversamples what the model gets wrong most on the test set: tag
 * judgment, start vs deadline wording, voice dictation, messy text and
 * title traps.
 */
export type Focus = "all" | "weak";

const WEAK_STYLE_PATTERN =
  /voice dictation|typos|brain dump|ramble|autocorrect|run-on|sloppy|non-native|dense|forwarded|polite sentences/;
const WEAK_TWIST_PATTERN =
  /deadline|due|start and a separate|work on it|tag|purpose|context|looks like a date|number that is not|duration-like|vague|false|correction/;
const WEAK_STYLES = STYLES.filter((style) => WEAK_STYLE_PATTERN.test(style));
const WEAK_TWISTS = TWISTS.filter((twist) => WEAK_TWIST_PATTERN.test(twist));
const WEAK_TAG_MODES = [
  [TAG_MODES[1][0], 0.35],
  [TAG_MODES[3][0], 0.25],
  [TAG_MODES[2][0], 0.2],
  [TAG_MODES[4][0], 0.1],
  [TAG_MODES[0][0], 0.1],
] as const;

export function planSlot(
  random: () => number,
  tagSets: string[][],
  personas: Persona[],
  focus: Focus = "all"
): Slot {
  if (focus === "weak" && random() < 0.6) {
    return weakSlot(random, tagSets, personas);
  }
  const labels = ["T"];
  for (const [label, rate] of Object.entries(LABEL_RATES)) {
    if (random() < rate) {
      labels.push(label);
    }
  }
  // A repeat usually carries its own day and time; a separate start is rarer.
  if (labels.includes("R") && labels.includes("S") && random() < 0.7) {
    labels.splice(labels.indexOf("S"), 1);
  }
  const generic = random() < 0.3;
  return {
    labels,
    persona: pick(random, personas),
    style: pick(random, STYLES),
    tagMode: pickMode(random, generic ? GENERIC_MODES : TAG_MODES),
    tags: generic
      ? genericTags(random)
      : shuffled(random, pick(random, tagSets)),
    twist: random() < 0.35 ? pick(random, TWISTS) : null,
  };
}

function weakSlot(
  random: () => number,
  tagSets: string[][],
  personas: Persona[]
): Slot {
  const labels = ["T", "D"];
  if (random() < 0.6) {
    labels.push("S", "U");
  } else if (random() < 0.5) {
    labels.push("S");
  }
  if (random() < 0.3) {
    labels.push("M");
  }
  const generic = random() < 0.4;
  return {
    labels,
    persona: pick(random, personas),
    style: random() < 0.7 ? pick(random, WEAK_STYLES) : pick(random, STYLES),
    tagMode: pickMode(random, generic ? GENERIC_MODES : WEAK_TAG_MODES),
    tags: generic
      ? genericTags(random)
      : shuffled(random, pick(random, tagSets)),
    twist: random() < 0.8 ? pick(random, WEAK_TWISTS) : null,
  };
}
