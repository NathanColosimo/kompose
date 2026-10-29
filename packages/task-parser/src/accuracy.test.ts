/**
 * The shipped model end to end on the evaluation sets, scored as
 * `bun gen/evaluate.ts` scores them. Fails when a set gets fewer cases
 * right than it does now; raise these when shipping a better model.
 */
import { expect, test } from "bun:test";
import { loadCases, score } from "../training/gen/evaluate";
import { createTaskParser } from "./parser";
import { shippedWeights } from "./test-fixtures";

/** Cases with every field right, and usable (see evaluate.ts), per set. */
const FLOORS: Record<string, { all: number; usable: number }> = {
  handwritten: { all: 34, usable: 34 },
  holidays: { all: 38, usable: 38 },
  test: { all: 924, usable: 1101 },
};

const parse = createTaskParser(shippedWeights());
const sets = await loadCases();

test.each(Object.entries(FLOORS))(
  "%s",
  (name, floor) => {
    const { all, usable } = score(parse, sets[name] ?? []);
    expect(all).toBeGreaterThanOrEqual(floor.all);
    expect(usable).toBeGreaterThanOrEqual(floor.usable);
  },
  120_000
);
