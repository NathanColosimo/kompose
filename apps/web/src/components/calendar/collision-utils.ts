/**
 * Collision detection utilities for calendar events.
 *
 * Calculates horizontal positioning for overlapping events:
 * - Events starting within 45 minutes of each other → side-by-side (max 3 columns)
 * - Events starting 45+ minutes apart → stack vertically (later on top)
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

  // Track when each column becomes available (end time of last item in column)
  const columnEndTimes: number[] = [];

  // Check if the cluster should use side-by-side layout
  // Compare earliest start to latest start in the cluster
  const earliestStart = sorted[0].startMinutes;
  const latestStart = sorted.at(-1)?.startMinutes ?? earliestStart;
  const useSideBySide =
    latestStart - earliestStart < SIDE_BY_SIDE_THRESHOLD_MINUTES;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    let assignedColumn = 0;

    if (useSideBySide) {
      // Find the first available column (where the item doesn't overlap)
      for (let col = 0; col < columnEndTimes.length; col++) {
        if (item.startMinutes >= columnEndTimes[col]) {
          assignedColumn = col;
          break;
        }
        assignedColumn = col + 1;
      }

      // Cap at MAX_COLUMNS - 1 (items beyond stack in last column)
      if (assignedColumn >= MAX_COLUMNS) {
        assignedColumn = MAX_COLUMNS - 1;
      }
    }
    // If not side-by-side, all items get column 0 (they stack)

    // Update column end time
    if (assignedColumn >= columnEndTimes.length) {
      columnEndTimes.push(item.endMinutes);
    } else {
      columnEndTimes[assignedColumn] = Math.max(
        columnEndTimes[assignedColumn],
        item.endMinutes
      );
    }

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

    // Check if cluster uses side-by-side layout
    const clusterSorted = [...cluster].sort(
      (a, b) => a.startMinutes - b.startMinutes
    );
    const earliestStart = clusterSorted[0].startMinutes;
    const latestStart = clusterSorted.at(-1)?.startMinutes ?? earliestStart;
    const useSideBySide =
      latestStart - earliestStart < SIDE_BY_SIDE_THRESHOLD_MINUTES;

    // Assign columns within the cluster
    const columnAssignments = assignColumnsToCluster(cluster);

    // Calculate total columns used in this cluster
    let maxColumn = 0;
    for (const { columnIndex } of columnAssignments.values()) {
      maxColumn = Math.max(maxColumn, columnIndex);
    }
    const totalColumns = useSideBySide ? maxColumn + 1 : 1;

    // Write final layout for each item in cluster
    for (const clusterItem of cluster) {
      const assignment = columnAssignments.get(clusterItem.id);
      if (assignment) {
        result.set(clusterItem.id, {
          columnIndex: useSideBySide ? assignment.columnIndex : 0,
          totalColumns,
          zIndex: assignment.zIndex,
        });
      }
    }
  }

  return result;
}
