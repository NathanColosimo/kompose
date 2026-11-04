/**
 * Holds out 15% of tag sets and personas for the test set only. Reads the
 * full pools (gen/seeds.ts), so a rerun gives the same split.
 */
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, rng } from "./common";

const seeds = `${ROOT}data/seeds/`;
const random = rng(7);
const tagSets = (
  JSON.parse(await readFile(`${seeds}tag-sets.json`, "utf8")) as {
    tags: string[];
  }[]
).map((set) => set.tags);
const personas = JSON.parse(
  await readFile(`${seeds}personas-all.json`, "utf8")
) as unknown[];

const split = <T>(items: T[]) => {
  const test: T[] = [];
  const train: T[] = [];
  for (const item of items) {
    (random() < 0.15 ? test : train).push(item);
  }
  return { test, train };
};
const tags = split(tagSets);
const people = split(personas);
await writeFile(`${seeds}split.json`, JSON.stringify(tags));
await writeFile(`${seeds}personas.json`, JSON.stringify(people.train, null, 1));
await writeFile(
  `${seeds}personas-test.json`,
  JSON.stringify(people.test, null, 1)
);
console.log(
  `tags ${tags.train.length}/${tags.test.length}, personas ${people.train.length}/${people.test.length}`
);
