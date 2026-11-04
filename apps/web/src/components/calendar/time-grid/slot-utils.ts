"use client";

import { MINUTES_STEP } from "../dnd/helpers";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Start minute of each 15-minute slot within an hour */
export const SLOT_MINUTES = [
  0,
  MINUTES_STEP,
  MINUTES_STEP * 2,
  MINUTES_STEP * 3,
];

export function getHoursRange(): number[] {
  return HOURS;
}
