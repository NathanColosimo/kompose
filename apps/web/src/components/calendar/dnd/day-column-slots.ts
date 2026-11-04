import type {
  ClientRect,
  CollisionDescriptor,
  CollisionDetection,
  DroppableContainer,
} from "@dnd-kit/core";
import { Temporal } from "temporal-polyfill";
import { PIXELS_PER_HOUR } from "../constants";
import { MINUTES_STEP } from "./helpers";
import type { DayColumnDropData } from "./types";

/**
 * Each day column is one droppable. The 15-minute slot under the drag is
 * derived from geometry, the same way dnd-kit would have picked between
 * one droppable per slot: `rectIntersection` on the slots, falling back to
 * `closestCenter` when the dragged rect touches nothing.
 */

/** Height of one 15-minute slot (20px). */
export const SLOT_HEIGHT = (MINUTES_STEP / 60) * PIXELS_PER_HOUR;
const SLOTS_PER_DAY = (24 * 60) / MINUTES_STEP;

type Rect = Pick<ClientRect, "height" | "left" | "top" | "width">;

interface Point {
  x: number;
  y: number;
}

function isDayColumnDropData(data: unknown): data is DayColumnDropData {
  return (data as DayColumnDropData | undefined)?.type === "day-column";
}

function clampSlotIndex(index: number): number {
  return Math.min(Math.max(index, 0), SLOTS_PER_DAY - 1);
}

function slotRect(column: Rect, index: number): Rect {
  return {
    height: SLOT_HEIGHT,
    left: column.left,
    top: column.top + index * SLOT_HEIGHT,
    width: column.width,
  };
}

function centerOf(rect: Rect): Point {
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
}

/** Same formula and rounding as dnd-kit's `rectIntersection`. */
function intersectionRatio(target: Rect, entry: Rect): number {
  const top = Math.max(target.top, entry.top);
  const left = Math.max(target.left, entry.left);
  const right = Math.min(target.left + target.width, entry.left + entry.width);
  const bottom = Math.min(target.top + target.height, entry.top + entry.height);
  if (!(left < right && top < bottom)) {
    return 0;
  }
  const intersection = (right - left) * (bottom - top);
  const ratio =
    intersection /
    (target.width * target.height + entry.width * entry.height - intersection);
  return Number(ratio.toFixed(4));
}

/** The slot the dragged rect overlaps most; the earliest slot wins ties. */
function mostOverlappedSlot(
  column: Rect,
  dragged: Rect
): { index: number; ratio: number } | null {
  const first = clampSlotIndex(
    Math.floor((dragged.top - column.top) / SLOT_HEIGHT)
  );
  const last = clampSlotIndex(
    Math.floor((dragged.top + dragged.height - column.top) / SLOT_HEIGHT)
  );
  let best: { index: number; ratio: number } | null = null;
  for (let index = first; index <= last; index += 1) {
    const ratio = intersectionRatio(slotRect(column, index), dragged);
    if (ratio > (best?.ratio ?? 0)) {
      best = { index, ratio };
    }
  }
  return best;
}

/** The slot whose center is nearest; the earliest slot wins ties. */
function closestSlotIndex(column: Rect, point: Point): number {
  const slotsFromFirstCenter =
    (point.y - column.top - SLOT_HEIGHT / 2) / SLOT_HEIGHT;
  return clampSlotIndex(Math.ceil(slotsFromFirstCenter - 0.5));
}

function droppableValue(
  container: DroppableContainer,
  rect: ClientRect,
  dragged: ClientRect
): number {
  return isDayColumnDropData(container.data.current)
    ? (mostOverlappedSlot(rect, dragged)?.ratio ?? 0)
    : intersectionRatio(rect, dragged);
}

function droppableDistance(
  container: DroppableContainer,
  rect: ClientRect,
  draggedCenter: Point
): number {
  const target = isDayColumnDropData(container.data.current)
    ? centerOf(slotRect(rect, closestSlotIndex(rect, draggedCenter)))
    : centerOf(rect);
  // Same arithmetic as dnd-kit's `closestCenter`, so ties resolve the same.
  return Math.sqrt(
    (target.x - draggedCenter.x) ** 2 + (target.y - draggedCenter.y) ** 2
  );
}

/**
 * Prefer droppables the dragged rect overlaps; fall back to the closest
 * center. Day columns are scored by their best slot, so the winner matches
 * what one droppable per slot would give.
 */
export const calendarCollisionDetection: CollisionDetection = ({
  collisionRect,
  droppableContainers,
  droppableRects,
}) => {
  const measured = droppableContainers.flatMap((container) => {
    const rect = droppableRects.get(container.id);
    return rect ? [{ container, rect }] : [];
  });

  const intersections: CollisionDescriptor[] = [];
  for (const { container, rect } of measured) {
    const value = droppableValue(container, rect, collisionRect);
    if (value > 0) {
      intersections.push({
        data: { droppableContainer: container, value },
        id: container.id,
      });
    }
  }
  if (intersections.length > 0) {
    return intersections.sort((a, b) => b.data.value - a.data.value);
  }

  const draggedCenter = centerOf(collisionRect);
  return measured
    .map(
      ({ container, rect }): CollisionDescriptor => ({
        data: {
          droppableContainer: container,
          value: droppableDistance(container, rect, draggedCenter),
        },
        id: container.id,
      })
    )
    .sort((a, b) => a.data.value - b.data.value);
};

export interface DropSlot {
  dateTime: Temporal.ZonedDateTime;
  /** Slot position within its column, 0 = midnight. */
  index: number;
  /** Viewport rect of the slot, as a per-slot droppable would report it. */
  rect: Rect;
}

/**
 * Resolve the slot a drag targets within a day column droppable, or null
 * when the droppable is not a day column.
 */
export function resolveDropSlot({
  columnData,
  columnRect,
  draggedRect,
}: {
  columnData: unknown;
  columnRect: ClientRect | null | undefined;
  draggedRect: ClientRect | null | undefined;
}): DropSlot | null {
  if (!(isDayColumnDropData(columnData) && columnRect && draggedRect)) {
    return null;
  }
  const index =
    mostOverlappedSlot(columnRect, draggedRect)?.index ??
    closestSlotIndex(columnRect, centerOf(draggedRect));
  const minutes = index * MINUTES_STEP;
  const { date, timeZone } = columnData;
  return {
    dateTime: Temporal.ZonedDateTime.from({
      day: date.day,
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      month: date.month,
      timeZone,
      year: date.year,
    }),
    index,
    rect: slotRect(columnRect, index),
  };
}
