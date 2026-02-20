/**
 * Shared collision detection utilities for calendar items (web + mobile).
 *
 * Calculates horizontal positioning for overlapping items:
 * - Overlapping items starting within 30 minutes of each other -> side-by-side columns
 * - Overlapping items starting 30+ minutes apart -> stack vertically (later on top)
 * - Items expand to full width (via columnSpan) when adjacent columns are empty
 *   at their specific time range, avoiding unnecessary compression.
 */

/** Threshold in minutes: events starting closer than this are displayed side-by-side */
const SIDE_BY_SIDE_THRESHOLD_MINUTES = 30;

/** Maximum number of side-by-side columns before stacking */
const MAX_COLUMNS = 3;

/**
 * Unified representation of a calendar item (task or google event)
 * for collision detection purposes.
 */
export interface PositionedItem {
  /** End time in minutes from midnight */
  endMinutes: number;
  /** Unique identifier for the item */
  id: string;
  /** Start time in minutes from midnight */
  startMinutes: number;
  /** Type discriminator */
  type: "task" | "google-event";
}

/**
 * Positioning information for an item after collision detection.
 */
export interface ItemLayout {
  /** Column index (0, 1, or 2) for horizontal positioning */
  columnIndex: number;
  /** How many consecutive columns this item spans (1 = own column only) */
  columnSpan: number;
  /** Total columns in this item's collision group */
  totalColumns: number;
  /** Z-index for stacking order (higher = on top) */
  zIndex: number;
}

/**
 * Check if two items overlap in time.
 */
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
    // Check if 'other' overlaps with any item already in the cluster
    const overlapsCluster = cluster.some((clusterItem) =>
      itemsOverlap(clusterItem, other)
    );
    if (overlapsCluster) {
      visited.add(other.id);
      // Recursively find more overlapping items
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
  // Track which items are assigned to each column for overlap checks
  const columnItems: PositionedItem[][] = [];

  for (const [i, item] of sorted.entries()) {
    // Find the first column where this item can fit:
    // either the column is empty, or every existing item in the column
    // either doesn't overlap or started far enough before this item.
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

    // zIndex based on processing order (later start = higher zIndex)
    result.set(item.id, {
      columnIndex: assignedColumn,
      zIndex: i + 1,
    });
  }

  return result;
}

/**
 * Calculate column spans for items in a cluster.
 *
 * For each item, checks how many consecutive columns to its right it can
 * expand into. A column is available for spanning when every item in it
 * either doesn't overlap or is "stackable" (this item started at least
 * SIDE_BY_SIDE_THRESHOLD_MINUTES after the other). This mirrors the same
 * threshold logic used in column assignment, so an item that can stack in
 * its own column can also span across adjacent columns under the same rule.
 */
function calculateColumnSpans(
  cluster: PositionedItem[],
  columnAssignments: Map<string, { columnIndex: number; zIndex: number }>,
  totalColumns: number
): Map<string, number> {
  const spans = new Map<string, number>();

  // Group items by their assigned column for fast lookup
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
    // Check consecutive columns to the right. A column blocks expansion only
    // if it contains an item that truly competes for the same visual space,
    // i.e. overlaps AND started within the threshold (side-by-side territory).
    for (let col = assignment.columnIndex + 1; col < totalColumns; col++) {
      const colItems = itemsByColumn.get(col) ?? [];
      const hasBlockingItem = colItems.some((other) => {
        if (!itemsOverlap(item, other)) {
          return false;
        }
        // If this item started far enough after the other, it can stack
        // across the column (same rule as assignColumnsToCluster).
        const startDelta = item.startMinutes - other.startMinutes;
        return startDelta < SIDE_BY_SIDE_THRESHOLD_MINUTES;
      });
      if (hasBlockingItem) {
        break;
      }
      span++;
    }

    spans.set(item.id, span);
  }

  return spans;
}

/**
 * Calculate collision layout for all items in a day.
 *
 * @param items - All positioned items for a single day
 * @returns Map from item ID to layout information (column, span, zIndex)
 */
export function calculateCollisionLayout(
  items: PositionedItem[]
): Map<string, ItemLayout> {
  if (items.length === 0) {
    return new Map();
  }

  // Sort items by start time for consistent processing
  const sortedItems = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes
  );

  const result = new Map<string, ItemLayout>();
  const visited = new Set<string>();

  for (const item of sortedItems) {
    if (visited.has(item.id)) {
      continue;
    }

    // Find all items in this collision cluster
    const cluster = findCollisionCluster(item, sortedItems, visited);

    if (cluster.length === 1) {
      // No collisions — single item takes full width
      result.set(item.id, {
        columnIndex: 0,
        totalColumns: 1,
        columnSpan: 1,
        zIndex: 1,
      });
      continue;
    }

    // Assign columns within the cluster
    const columnAssignments = assignColumnsToCluster(cluster);

    // Calculate total columns used in this cluster
    let maxColumn = 0;
    for (const { columnIndex } of columnAssignments.values()) {
      maxColumn = Math.max(maxColumn, columnIndex);
    }
    const totalColumns = maxColumn + 1;

    // Calculate per-item column spans so items expand when adjacent cols are empty
    const columnSpans = calculateColumnSpans(
      cluster,
      columnAssignments,
      totalColumns
    );

    // Write final layout for each item in cluster.
    // zIndex follows start-time order (later start = higher = on top).
    // This is standard calendar stacking: when a later event overlaps an
    // earlier one in the same column, the later event renders on top so its
    // title and time are visible.
    for (const clusterItem of cluster) {
      const assignment = columnAssignments.get(clusterItem.id);
      if (assignment) {
        result.set(clusterItem.id, {
          columnIndex: assignment.columnIndex,
          totalColumns,
          columnSpan: columnSpans.get(clusterItem.id) ?? 1,
          zIndex: assignment.zIndex,
        });
      }
    }
  }

  return result;
}
