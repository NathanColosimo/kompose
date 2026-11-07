import { describe, expect, test } from "bun:test";
import {
  calculateCollisionLayout,
  type PositionedItem,
} from "./collision-utils";

const item = (id: string, start: number, end: number): PositionedItem => ({
  endMinutes: end,
  id,
  startMinutes: start,
  type: "google-event",
});

const at = (hour: number, minute = 0) => hour * 60 + minute;

describe("calculateCollisionLayout", () => {
  test("puts items that start together side by side", () => {
    const layout = calculateCollisionLayout([
      item("a", at(10), at(11)),
      item("b", at(10), at(11)),
    ]);
    expect(layout.get("a")).toMatchObject({
      columnIndex: 0,
      stackDepth: 0,
      totalColumns: 2,
    });
    expect(layout.get("b")).toMatchObject({
      columnIndex: 1,
      stackDepth: 0,
      totalColumns: 2,
    });
  });

  test("keeps a long block full width under meetings that start inside it", () => {
    // A busy morning: a 9–12 block, two meetings at 9:30, two at 10:00 and
    // 10:15, and one at 10:30.
    const layout = calculateCollisionLayout([
      item("hiring", at(9), at(12)),
      item("standup", at(9, 30), at(9, 45)),
      item("oneOnOne", at(9, 30), at(10)),
      item("roadmap", at(10), at(11)),
      item("prep", at(10, 15), at(10, 45)),
      item("vendor", at(10, 30), at(11, 15)),
    ]);
    expect(layout.get("hiring")).toMatchObject({
      stackDepth: 0,
      totalColumns: 1,
    });
    // Each pair shares the width inside a one-level indent.
    expect(layout.get("standup")).toMatchObject({
      stackDepth: 1,
      totalColumns: 2,
    });
    expect(layout.get("oneOnOne")).toMatchObject({
      stackDepth: 1,
      totalColumns: 2,
    });
    expect(
      new Set([
        layout.get("standup")?.columnIndex,
        layout.get("oneOnOne")?.columnIndex,
      ])
    ).toEqual(new Set([0, 1]));
    expect(layout.get("roadmap")).toMatchObject({
      columnIndex: 0,
      stackDepth: 1,
      totalColumns: 2,
    });
    expect(layout.get("prep")).toMatchObject({
      columnIndex: 1,
      stackDepth: 1,
      totalColumns: 2,
    });
    // Starts 30 minutes into the 10:00 pair, so it sits one level deeper.
    expect(layout.get("vendor")).toMatchObject({
      stackDepth: 2,
      totalColumns: 1,
    });
  });

  test("never covers an item before a line of it shows", () => {
    const layout = calculateCollisionLayout([
      item("block", at(10), at(12)),
      item("early", at(10, 25), at(11, 15)),
      item("late", at(10, 30), at(11, 30)),
    ]);
    // Stacking "late" on its own would leave 5 minutes of "early" in view,
    // so the two sit side by side, together stacked on "block".
    expect(layout.get("block")).toMatchObject({
      stackDepth: 0,
      totalColumns: 1,
      uncoveredMinutes: 25,
    });
    expect(layout.get("early")).toMatchObject({
      stackDepth: 1,
      totalColumns: 2,
    });
    expect(layout.get("late")).toMatchObject({
      stackDepth: 1,
      totalColumns: 2,
    });
  });

  test("keeps items that start close to their group's start side by side", () => {
    const layout = calculateCollisionLayout([
      item("a", at(10), at(11)),
      item("b", at(10, 5), at(11)),
      item("c", at(10, 10), at(11)),
    ]);
    expect(layout.get("c")).toMatchObject({ stackDepth: 0, totalColumns: 3 });
  });

  test("reports how much of an item shows above the group drawn on it", () => {
    const layout = calculateCollisionLayout([
      item("roadmap", at(10), at(11)),
      item("prep", at(10, 15), at(10, 45)),
      item("vendor", at(10, 30), at(11, 15)),
    ]);
    // Vendor call starts a deeper group at 10:30, on top of both.
    expect(layout.get("roadmap")?.uncoveredMinutes).toBe(30);
    expect(layout.get("prep")?.uncoveredMinutes).toBe(15);
    expect(layout.get("vendor")?.uncoveredMinutes).toBe(45);
  });

  test("draws later starts on top", () => {
    const layout = calculateCollisionLayout([
      item("late", at(10), at(11)),
      item("early", at(9), at(12)),
    ]);
    expect(layout.get("early")?.zIndex).toBeLessThan(
      layout.get("late")?.zIndex ?? 0
    );
  });

  test("widens an item into a free column beside it", () => {
    const layout = calculateCollisionLayout([
      item("long", at(10), at(11)),
      item("first", at(10), at(10, 15)),
      item("second", at(10, 5), at(10, 20)),
      item("later", at(10, 20), at(10, 50)),
    ]);
    expect(layout.get("second")).toMatchObject({ columnIndex: 2 });
    // "later" reuses column 1 and spreads into column 2, free by then.
    expect(layout.get("later")).toMatchObject({
      columnIndex: 1,
      columnSpan: 2,
      totalColumns: 3,
    });
  });

  test("lays out short items at their drawn height", () => {
    // A 5-minute task and one right after it, drawn at least 24 minutes tall.
    const layout = calculateCollisionLayout(
      [item("first", at(10), at(10, 5)), item("next", at(10, 5), at(10, 10))],
      { minDrawnMinutes: 24 }
    );
    expect(layout.get("first")?.totalColumns).toBe(2);
    expect(layout.get("next")?.totalColumns).toBe(2);
  });

  test("puts zero-length items at the same time side by side", () => {
    const layout = calculateCollisionLayout([
      item("a", at(9), at(9)),
      item("b", at(9), at(9)),
    ]);
    expect(layout.get("a")?.totalColumns).toBe(2);
  });

  test("leaves lone items flat", () => {
    expect(calculateCollisionLayout([item("a", 0, 30)]).get("a")).toEqual({
      columnIndex: 0,
      columnSpan: 1,
      stackDepth: 0,
      totalColumns: 1,
      uncoveredMinutes: 30,
      zIndex: 1,
    });
  });
});
