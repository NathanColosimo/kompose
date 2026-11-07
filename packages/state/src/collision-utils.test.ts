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

  test("leaves lone items flat", () => {
    expect(calculateCollisionLayout([item("a", 0, 30)]).get("a")).toEqual({
      columnIndex: 0,
      columnSpan: 1,
      stackDepth: 0,
      totalColumns: 1,
      zIndex: 1,
    });
  });
});
