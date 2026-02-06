/**
 * Collision detection utilities for calendar items.
 *
 * Calculates horizontal positioning for overlapping items:
 * - Overlapping items starting within 45 minutes of each other -> side-by-side
 * - Overlapping items starting 45+ minutes apart -> stack vertically (later on top)
 */

/** Threshold in minutes: events starting closer than this are displayed side-by-side */
const SIDE_BY_SIDE_THRESHOLD_MINUTES = 45;

/** Maximum number of side-by-side columns before stacking */
const MAX_COLUMNS = 3;

/**
 * Unified representation of a calendar item (task or google event)
 * for collision detection purposes.
 */
export interface PositionedItem {
  /** Unique identifier for the item */
  id: string;
  /** Type discriminator */
  type: "task" | "google-event";
  /** Start time in minutes from midnight */
  startMinutes: number;
  /** End time in minutes from midnight */
  endMinutes: number;
}

/**
 * Positioning information for an item after collision detection.
 */
export interface ItemLayout {
  /** Column index (0, 1, or 2) for horizontal positioning */
  columnIndex: number;
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
    // Check if 'other' overlaps with any item in our cluster
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
 * Items are processed in start time order.
 */
function assignColumnsToCluster(
  cluster: PositionedItem[]
): Map<string, { columnIndex: number; zIndex: number }> {
  // Sort cluster by start time
  const sorted = [...cluster].sort((a, b) => a.startMinutes - b.startMinutes);
  const result = new Map<string, { columnIndex: number; zIndex: number }>();
  const columnItems: PositionedItem[][] = [];

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
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
    columnItems[assignedColumn].push(item);

    // zIndex based on processing order (later start = higher zIndex)
    result.set(item.id, {
      columnIndex: assignedColumn,
      zIndex: i + 1,
    });
  }

  return result;
}

/**
 * Calculate collision layout for all items in a day.
 *
 * @param items - All positioned items for a single day
 * @returns Map from item ID to layout information
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
      // No collisions - single item takes full width
      result.set(item.id, {
        columnIndex: 0,
        totalColumns: 1,
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

    // Write final layout for each item in cluster
    for (const clusterItem of cluster) {
      const assignment = columnAssignments.get(clusterItem.id);
      if (assignment) {
        result.set(clusterItem.id, {
          columnIndex: assignment.columnIndex,
          totalColumns,
          zIndex: assignment.zIndex,
        });
      }
    }
  }

  return result;
}
