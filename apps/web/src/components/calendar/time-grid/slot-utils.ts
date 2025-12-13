"use client";

import { MINUTES_STEP } from "../dnd/helpers";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Minutes within each hour that have droppable slots */
export const SLOT_MINUTES = [
  0,
  MINUTES_STEP,
  MINUTES_STEP * 2,
  MINUTES_STEP * 3,
];

export function getHoursRange(): number[] {
  return HOURS;
}
