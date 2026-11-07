/**
 * Horizontal layout for overlapping calendar items (web + native).
 *
 * Items are grouped in start order. An item joins the latest group when it
 * starts within 30 minutes of that group's first item and overlaps one of its
 * members; otherwise it starts a new group. Members of a group sit side by
 * side, splitting the group's width.
 *
 * Each group is indented one level deeper than the deepest earlier group
 * still running when it starts, and runs to the right edge. So a long block
 * keeps its full width, and a meeting that starts inside it sits on top with
 * a small indent, leaving the block's edge (and its title, above) in view.
 */

/** Items starting closer together than this sit side by side. */
const SIDE_BY_SIDE_THRESHOLD_MINUTES = 30;

export interface PositionedItem {
  /** End time in minutes from midnight */
  endMinutes: number;
  id: string;
  /** Start time in minutes from midnight */
  startMinutes: number;
  type: "task" | "google-event" | "whoop-workout";
}

export interface ItemLayout {
  /** Column within the item's group, from 0. */
  columnIndex: number;
  /** Consecutive group columns the item spans (1 = its own column). */
  columnSpan: number;
  /**
   * Indent level: how many groups run underneath this one. Renderers indent
   * by this much, then split the rest of the width into `totalColumns`.
   */
  stackDepth: number;
  /** Columns in the item's group. */
  totalColumns: number;
  zIndex: number;
}

interface Group {
  depth: number;
  members: PositionedItem[];
  start: number;
}

function itemsOverlap(a: PositionedItem, b: PositionedItem): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

function isRunningAt(item: PositionedItem, minutes: number): boolean {
  return item.startMinutes <= minutes && item.endMinutes > minutes;
}

/** Split items into side-by-side groups and give each its indent level. */
function groupItems(sorted: PositionedItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of sorted) {
    const latest = groups.at(-1);
    if (
      latest &&
      item.startMinutes - latest.start < SIDE_BY_SIDE_THRESHOLD_MINUTES &&
      latest.members.some((member) => itemsOverlap(member, item))
    ) {
      latest.members.push(item);
      continue;
    }
    let depth = 0;
    for (const group of groups) {
      if (
        group.members.some((member) => isRunningAt(member, item.startMinutes))
      ) {
        depth = Math.max(depth, group.depth + 1);
      }
    }
    groups.push({ depth, members: [item], start: item.startMinutes });
  }
  return groups;
}

/** First-fit columns within a group, then widen each item into free columns. */
function layoutGroup(
  group: Group,
  zIndexOf: Map<string, number>,
  result: Map<string, ItemLayout>
): void {
  const columns: PositionedItem[][] = [];
  const columnOf = new Map<string, number>();
  for (const member of group.members) {
    let index = columns.findIndex((column) =>
      column.every((other) => !itemsOverlap(member, other))
    );
    if (index === -1) {
      index = columns.length;
      columns.push([]);
    }
    columns[index]?.push(member);
    columnOf.set(member.id, index);
  }

  for (const member of group.members) {
    const columnIndex = columnOf.get(member.id) ?? 0;
    let columnSpan = 1;
    for (let next = columnIndex + 1; next < columns.length; next += 1) {
      if (columns[next]?.some((other) => itemsOverlap(member, other))) {
        break;
      }
      columnSpan += 1;
    }
    result.set(member.id, {
      columnIndex,
      columnSpan,
      stackDepth: group.depth,
      totalColumns: columns.length,
      zIndex: zIndexOf.get(member.id) ?? 1,
    });
  }
}

/**
 * Lay out one day at a time; startMinutes/endMinutes are relative to that day.
 * `minDrawnMinutes` is the shortest block the caller draws (its minimum
 * height in minutes): items are laid out as drawn, so a 5-minute task and
 * the one right after it sit side by side instead of hiding each other.
 */
export function calculateCollisionLayout(
  items: PositionedItem[],
  { minDrawnMinutes = 15 }: { minDrawnMinutes?: number } = {}
): Map<string, ItemLayout> {
  const drawn = items.map((item) => ({
    ...item,
    endMinutes: Math.max(item.endMinutes, item.startMinutes + minDrawnMinutes),
  }));
  // Earlier first; for equal starts the longer item goes first, underneath.
  const sorted = drawn.sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      b.endMinutes - b.startMinutes - (a.endMinutes - a.startMinutes)
  );
  // Later starts render on top so stacked items keep their titles visible.
  const zIndexOf = new Map(sorted.map((item, index) => [item.id, index + 1]));

  const result = new Map<string, ItemLayout>();
  for (const group of groupItems(sorted)) {
    layoutGroup(group, zIndexOf, result);
  }
  return result;
}
