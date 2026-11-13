/// <reference types="bun" />

import { expect, test } from "bun:test";
import { fitBlockRest } from "./block-fit";

test("a row that doesn't fit whole is left out", () => {
  expect(fitBlockRest({ detailCount: 2, roomPt: 20, scale: 1 })).toEqual({
    descriptionLines: 0,
    rows: 1,
  });
});

test("the description takes whole lines under the rows", () => {
  // Two rows (30pt), a 2pt gap, then 41pt: three 13pt lines.
  expect(fitBlockRest({ detailCount: 2, roomPt: 73, scale: 1 })).toEqual({
    descriptionLines: 3,
    rows: 2,
  });
});

test("a line that would be cut short is left out", () => {
  expect(fitBlockRest({ detailCount: 0, roomPt: 14, scale: 1 })).toEqual({
    descriptionLines: 0,
    rows: 0,
  });
  expect(fitBlockRest({ detailCount: 0, roomPt: 15, scale: 1 })).toEqual({
    descriptionLines: 1,
    rows: 0,
  });
});

test("larger system text fits fewer lines", () => {
  expect(fitBlockRest({ detailCount: 1, roomPt: 73, scale: 1.5 })).toEqual({
    descriptionLines: 2,
    rows: 1,
  });
});

test("no room shows nothing", () => {
  expect(fitBlockRest({ detailCount: 2, roomPt: -4, scale: 1 })).toEqual({
    descriptionLines: 0,
    rows: 0,
  });
});
