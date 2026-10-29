/**
 * Seed pools for generation: users' tag lists and personas.
 * Usage: bun gen/seeds.ts
 * Writes data/seeds/tag-sets.json and personas-all.json for gen/split.ts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { codexJson, pool } from "./codex";
import { listSchema, type Persona, ROOT } from "./common";

const OUT = `${ROOT}data/seeds/`;
const MODEL = "gpt-6-luna";

const TAG_THEMES = [
  "software engineers and startup founders",
  "university students juggling classes, jobs and clubs",
  "parents running a household",
  "freelancers with several named clients",
  "nurses, doctors and shift workers",
  "salespeople and account managers",
  "academics and researchers",
  "designers, writers and other creatives",
  "small business owners (cafe, shop, trades)",
  "retirees and volunteers",
  "athletes and people training for events",
  "GTD fans who use contexts like @home, @computer, @errands, @calls",
  "people who put emojis in front of every tag",
  "minimalists with only 2-3 broad tags",
  "maximalists with 15-25 very specific tags",
  "people who tag by project or product name (made-up names, codenames)",
  "people who tag by energy, priority or effort (urgent, quick win, low energy, p1)",
  "people whose tags are all lowercase or have odd casing/abbreviations",
  "people who tag by person or relationship (mom, partner, kids, team names)",
  "people mixing work, side projects and hobbies",
  "lawyers, accountants and consultants with matters/engagements",
  "content creators, streamers and podcasters",
  "teachers and coaches",
  "people managing health conditions, therapy and appointments",
  "people planning a wedding, move or renovation",
  "people whose tags are common verbs or words (Read, Call, Buy, Watch, Later, Home)",
  "people with confusable tags (Work vs Work Travel, Health vs Mental Health, Home vs Home Office)",
  "remote workers across time zones with team and meeting tags",
  "people learning languages, instruments or skills",
  "people with tags in a mix of English and another language",
];

const PERSONA_THEMES = [
  "a wide mix of occupations and ages",
  "busy professionals in tech, finance, law and healthcare",
  "students, young adults and people early in their careers",
  "parents, caregivers and people managing a household",
  "trades, service, retail and shift workers",
  "creatives, freelancers, founders and small business owners",
  "older adults, retirees, volunteers and hobbyists",
  "people with ADHD or who brain-dump everything as it comes",
];

const tagSetSchema = listSchema("sets", {
  tags: { items: { type: "string" }, type: "array" },
});
const personaSchema = listSchema("personas", {
  description: { type: "string" },
  writingHabits: { type: "string" },
});

function tagPrompt(theme: string) {
  return `Do not run commands. Answer only with the JSON object.

Invent 50 realistic tag lists that different users of a personal task manager might have. Focus on: ${theme}.
Each list is one user's complete set of tags, between 2 and 25 tags (vary the size a lot; most users have 4-10).
Make them feel real: the names people actually type, with their quirks of casing, emoji, abbreviations, spaces, and specificity. Do not repeat lists, and do not make every list cover the same life areas.`;
}

function personaPrompt(theme: string) {
  return `Do not run commands. Answer only with the JSON object.

Invent 50 distinct people who use a quick-add box to capture tasks. Focus on: ${theme}.
For each, "description" is 1-2 sentences: who they are, what fills their days, and the kinds of tasks they capture.
"writingHabits" is 1 sentence on how they type into the box (terse, lowercase, voice dictation, typos, abbreviations, emojis, long rambles, punctuation habits, etc.). Vary these a lot.`;
}

await mkdir(OUT, { recursive: true });

const tagJobs = TAG_THEMES.map(
  (theme) => () =>
    codexJson<{ sets: { tags: string[] }[] }>({
      model: MODEL,
      prompt: tagPrompt(theme),
      schema: tagSetSchema,
    })
);
const personaJobs = PERSONA_THEMES.map(
  (theme) => () =>
    codexJson<{ personas: Persona[] }>({
      model: MODEL,
      prompt: personaPrompt(theme),
      schema: personaSchema,
    })
);

const [tagResults, personaResults] = await Promise.all([
  pool("tags", tagJobs, 16),
  pool("personas", personaJobs, 8),
]);

const seen = new Set<string>();
const tagSets = tagResults.flatMap((result, index) =>
  result instanceof Error
    ? []
    : result.sets
        .map((set) => [
          ...new Set(set.tags.map((tag) => tag.trim()).filter(Boolean)),
        ])
        .filter((tags) => {
          const key = tags
            .map((tag) => tag.toLowerCase())
            .sort()
            .join("|");
          if (tags.length < 2 || seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .map((tags) => ({ tags, theme: TAG_THEMES[index] }))
);
const personas = personaResults.flatMap((result) =>
  result instanceof Error ? [] : result.personas
);

await writeFile(`${OUT}tag-sets.json`, JSON.stringify(tagSets, null, 1));
await writeFile(`${OUT}personas-all.json`, JSON.stringify(personas, null, 1));
console.log(`${tagSets.length} tag sets, ${personas.length} personas`);
