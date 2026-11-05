/** Shared calendar layout; see documents/state.md for the column and stacking rules. */

/** Threshold in minutes: events starting closer than this are displayed side-by-side */
const SIDE_BY_SIDE_THRESHOLD_MINUTES = 30;

/** Maximum number of side-by-side columns before stacking */
const MAX_COLUMNS = 3;

export interface PositionedItem {
  /** End time in minutes from midnight */
  endMinutes: number;
  id: string;
  /** Start time in minutes from midnight */
  startMinutes: number;
  type: "task" | "google-event" | "whoop-workout";
}

export interface ItemLayout {
  /** Column index (0, 1, or 2) for horizontal positioning */
  columnIndex: number;
  /** How many consecutive columns this item spans (1 = own column only) */
  columnSpan: number;
  /** Total columns in this item's collision group */
  totalColumns: number;
  zIndex: number;
}

function itemsOverlap(a: PositionedItem, b: PositionedItem): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

/**
 * Find all items that overlap with a given item, recursively expanding
 * to find the complete collision cluster.
 */
function findCollisionCluster(
  item: PositionedItem,
  allItems: PositionedItem[],
  visited: Set<string>
): PositionedItem[] {
  const cluster: PositionedItem[] = [item];
  visited.add(item.id);

  for (const other of allItems) {
    if (visited.has(other.id)) {
      continue;
    }
    const overlapsCluster = cluster.some((clusterItem) =>
      itemsOverlap(clusterItem, other)
    );
    if (overlapsCluster) {
      visited.add(other.id);
      const subCluster = findCollisionCluster(other, allItems, visited);
      cluster.push(...subCluster.filter((i) => i.id !== other.id));
      cluster.push(other);
    }
  }

  return cluster;
}

/**
 * Assign columns to items in a cluster using a greedy first-available-slot algorithm.
 * Items are processed in start time order. An item can reuse a column when it starts
 * at least SIDE_BY_SIDE_THRESHOLD_MINUTES after the existing item in that column.
 */
function assignColumnsToCluster(
  cluster: PositionedItem[]
): Map<string, { columnIndex: number; zIndex: number }> {
  const sorted = [...cluster].sort((a, b) => a.startMinutes - b.startMinutes);
  const result = new Map<string, { columnIndex: number; zIndex: number }>();
  const columnItems: PositionedItem[][] = [];

  for (const [i, item] of sorted.entries()) {
    let assignedColumn = columnItems.findIndex((itemsInColumn) =>
      itemsInColumn.every((existing) => {
        if (!itemsOverlap(item, existing)) {
          return true;
        }
        const startDelta = item.startMinutes - existing.startMinutes;
        return startDelta >= SIDE_BY_SIDE_THRESHOLD_MINUTES;
      })
    );

    if (assignedColumn === -1) {
      assignedColumn = columnItems.length;
    }

    // Cap at MAX_COLUMNS - 1 (items beyond stack in last column)
    if (assignedColumn >= MAX_COLUMNS) {
      assignedColumn = MAX_COLUMNS - 1;
    }

    columnItems[assignedColumn] ??= [];
    const col = columnItems[assignedColumn] as PositionedItem[];
    col.push(item);

    // Later starts render on top so stacked items retain visible titles and times.
    result.set(item.id, {
      columnIndex: assignedColumn,
      zIndex: i + 1,
    });
  }

  return result;
}

/** Use the column-assignment threshold for expansion too, so stackable items can share width. */
function calculateColumnSpans(
  cluster: PositionedItem[],
  columnAssignments: Map<string, { columnIndex: number; zIndex: number }>,
  totalColumns: number
): Map<string, number> {
  const spans = new Map<string, number>();

  const itemsByColumn = new Map<number, PositionedItem[]>();
  for (const item of cluster) {
    const assignment = columnAssignments.get(item.id);
    if (!assignment) {
      continue;
    }
    const col = assignment.columnIndex;
    if (!itemsByColumn.has(col)) {
      itemsByColumn.set(col, []);
    }
    itemsByColumn.get(col)?.push(item);
  }

  for (const item of cluster) {
    const assignment = columnAssignments.get(item.id);
    if (!assignment) {
      continue;
    }

    let span = 1;
    for (let col = assignment.columnIndex + 1; col < totalColumns; col += 1) {
      const colItems = itemsByColumn.get(col) ?? [];
      const hasBlockingItem = colItems.some((other) => {
        if (!itemsOverlap(item, other)) {
          return false;
        }
        // Later-starting items also block: the delta is intentionally signed.
        const startDelta = item.startMinutes - other.startMinutes;
        return startDelta < SIDE_BY_SIDE_THRESHOLD_MINUTES;
      });
      if (hasBlockingItem) {
        break;
      }
      span += 1;
    }

    spans.set(item.id, span);
  }

  return spans;
}

/** Lay out one day at a time; startMinutes/endMinutes are relative to that day. */
export function calculateCollisionLayout(
  items: PositionedItem[]
): Map<string, ItemLayout> {
  if (items.length === 0) {
    return new Map();
  }

  const sortedItems = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes
  );

  const result = new Map<string, ItemLayout>();
  const visited = new Set<string>();

  for (const item of sortedItems) {
    if (visited.has(item.id)) {
      continue;
    }

    const cluster = findCollisionCluster(item, sortedItems, visited);

    if (cluster.length === 1) {
      result.set(item.id, {
        columnIndex: 0,
        columnSpan: 1,
        totalColumns: 1,
        zIndex: 1,
      });
      continue;
    }

    const columnAssignments = assignColumnsToCluster(cluster);

    let maxColumn = 0;
    for (const { columnIndex } of columnAssignments.values()) {
      maxColumn = Math.max(maxColumn, columnIndex);
    }
    const totalColumns = maxColumn + 1;

    const columnSpans = calculateColumnSpans(
      cluster,
      columnAssignments,
      totalColumns
    );

    for (const clusterItem of cluster) {
      const assignment = columnAssignments.get(clusterItem.id);
      if (assignment) {
        result.set(clusterItem.id, {
          columnIndex: assignment.columnIndex,
          columnSpan: columnSpans.get(clusterItem.id) ?? 1,
          totalColumns,
          zIndex: assignment.zIndex,
        });
      }
    }
  }

  return result;
}
