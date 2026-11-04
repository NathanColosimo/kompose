import {
  type ClientRect,
  type Collision,
  type CollisionDetection,
  closestCenter,
  rectIntersection,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { atom } from "jotai";
import { Temporal } from "temporal-polyfill";
import { SLOT_HEIGHT } from "../constants";
import { MINUTES_STEP } from "./helpers";
import type { DayColumnDropData } from "./types";

const SLOTS_PER_DAY = (24 * 60) / MINUTES_STEP;

/** The 15-minute slot a drag targets within a day column droppable. */
export interface DropSlot {
  column: DayColumnDropData;
  /** The column droppable's measured rect; dnd-kit keeps it scroll-adjusted. */
  columnRect: ClientRect;
  /** 0 = midnight. */
  index: number;
}

/** The slot under the current calendar drag, for the column highlight. */
export const dropSlotAtom = atom<DropSlot | null>(null);

function clampSlot(index: number): number {
  return Math.min(Math.max(index, 0), SLOTS_PER_DAY - 1);
}

/**
 * The slot holding the dragged rect's vertical center, which is the slot
 * whose center is nearest. On a boundary the earlier slot wins.
 */
function nearestSlot(column: ClientRect, dragged: ClientRect): number {
  const centerY = dragged.top + dragged.height / 2;
  return clampSlot(Math.ceil((centerY - column.top) / SLOT_HEIGHT) - 1);
}

/**
 * The earliest slot with the most vertical overlap: the first slot the
 * dragged rect fully covers, else the one holding its center. Slots span the
 * column's full width, so this is also the slot with the best intersection
 * ratio.
 */
function mostOverlappedSlot(column: ClientRect, dragged: ClientRect): number {
  const firstCovered = Math.max(
    Math.ceil((dragged.top - column.top) / SLOT_HEIGHT),
    0
  );
  const coversIt =
    column.top + (firstCovered + 1) * SLOT_HEIGHT <= dragged.bottom;
  return coversIt ? clampSlot(firstCovered) : nearestSlot(column, dragged);
}

/**
 * Runs `detect` with each day column measured as the slot `pickSlot` chooses
 * in it, and records that slot on the column's collision.
 */
function detectAsSlots(
  args: Parameters<CollisionDetection>[0],
  detect: CollisionDetection,
  pickSlot: (column: ClientRect, dragged: ClientRect) => number
): Collision[] {
  const droppableRects = new Map(args.droppableRects);
  const slots = new Map<UniqueIdentifier, DropSlot>();
  for (const { id, data } of args.droppableContainers) {
    const columnRect = args.droppableRects.get(id);
    if (!(columnRect && data.current?.type === "day-column")) {
      continue;
    }
    const index = pickSlot(columnRect, args.collisionRect);
    const top = columnRect.top + index * SLOT_HEIGHT;
    slots.set(id, {
      column: data.current as DayColumnDropData,
      columnRect,
      index,
    });
    droppableRects.set(id, {
      bottom: top + SLOT_HEIGHT,
      height: SLOT_HEIGHT,
      left: columnRect.left,
      right: columnRect.right,
      top,
      width: columnRect.width,
    });
  }
  return detect({ ...args, droppableRects }).map((collision) => ({
    ...collision,
    data: { ...collision.data, slot: slots.get(collision.id) },
  }));
}

/**
 * dnd-kit's `rectIntersection`, falling back to `closestCenter`, as if every
 * 15-minute slot were its own droppable. Each day column stands in for the
 * slot that would win within it, so columns compete with the sidebar as the
 * slots did.
 */
export const calendarCollisionDetection: CollisionDetection = (args) => {
  const intersections = detectAsSlots(
    args,
    rectIntersection,
    mostOverlappedSlot
  );
  return intersections.length > 0
    ? intersections
    : detectAsSlots(args, closestCenter, nearestSlot);
};

/** The day-column slot of the winning collision, if it is a day column. */
export function getDropSlot(
  collisions: Collision[] | null
): DropSlot | undefined {
  return collisions?.[0]?.data?.slot;
}

export function slotDateTime({
  column,
  index,
}: DropSlot): Temporal.ZonedDateTime {
  return column.date.toZonedDateTime({
    plainTime: new Temporal.PlainTime().add({ minutes: index * MINUTES_STEP }),
    timeZone: column.timeZone,
  });
}
