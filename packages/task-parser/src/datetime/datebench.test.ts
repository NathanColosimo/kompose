/**
 * The date benchmark (training/testset/dates.jsonl) as `bun gen/datebench.ts
 * score` runs it: labelled spans through resolveFields, per category. Fails
 * when a category gets fewer items right than it does now.
 */
import { expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { dateMismatches, readJsonl } from "../../training/gen/common";
import { resolveFields } from "../fields";
import { parseMarkup } from "../spans";

/** Items right per category; raise these as the date code improves. */
const RIGHT: Record<string, number> = {
  absolute: 192,
  clock: 186,
  deadlines: 196,
  holidays: 191,
  languages: 199,
  offsets: 202,
  periods: 189,
  ranges: 197,
  relative: 199,
  repeats: 183,
  typos: 194,
  zones: 149,
};

interface Row {
  category: string;
  expect: Record<string, unknown>;
  marked: string;
  now: string;
}

test("date benchmark", async () => {
  const rows = await readJsonl<Row>(
    new URL("../../training/testset/dates.jsonl", import.meta.url).pathname
  );
  const right: Record<string, number> = {};
  for (const row of rows) {
    const { spans, text } = parseMarkup(row.marked);
    const fields = resolveFields({
      now: Temporal.ZonedDateTime.from(row.now),
      spans,
      text,
    });
    const actual = {
      dueDate: fields.dueDate?.toString() ?? null,
      durationMinutes: fields.durationMinutes,
      recurrence: fields.recurrence,
      startDate: fields.startDate?.toString() ?? null,
      startTime: fields.startTime?.toString() ?? null,
    };
    const wrong = dateMismatches(row.expect, actual).length > 0;
    right[row.category] = (right[row.category] ?? 0) + (wrong ? 0 : 1);
  }
  const dropped = Object.entries(RIGHT)
    .filter(([category, count]) => (right[category] ?? 0) < count)
    .map(([category, count]) => `${category}: ${right[category]} < ${count}`);
  expect(dropped).toEqual([]);
});
