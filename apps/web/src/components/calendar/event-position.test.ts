/// <reference types="bun" />

import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  calculateCollisionLayout,
  type PositionedItem,
} from "@kompose/state/collision-utils";
import { blockHorizontalStyle } from "./event-position";

// Resolve the CSS arithmetic at a real column width, independently of the layout algorithm.
const pixels = (value: string | number | undefined) =>
  Number(
    runInNewContext(
      String(value)
        .replaceAll("calc", "")
        .replace(/([\d.]+)%/g, "($1 * columnWidth / 100)")
        .replaceAll("px", ""),
      { columnWidth: 200 }
    )
  );

for (const type of ["google-event", "task", "whoop-workout"] as const) {
  test(`a later ${type} leaves an exposed strip for the earlier end-resize handle`, () => {
    const items: PositionedItem[] = [
      {
        id: "earlier",
        type: "google-event",
        startMinutes: 540,
        endMinutes: 600,
      },
      { id: "later", type, startMinutes: 570, endMinutes: 630 },
    ];
    const layouts = calculateCollisionLayout(items);
    const earlier = blockHorizontalStyle(layouts.get("earlier"));
    const later = blockHorizontalStyle(layouts.get("later"));
    // At the earlier item's bottom, the later block overlaps it vertically.
    // A point inside the earlier grip's left edge must remain outside the later block.
    const handleX = pixels(earlier.left) + 4;
    expect(handleX).toBeLessThan(pixels(earlier.left) + pixels(earlier.width));
    expect(handleX).toBeLessThan(pixels(later.left));
  });
}
