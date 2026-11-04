import { MINUTES_STEP } from "./dnd/helpers";

/** Pixels per hour in the calendar grid (4 slots × 20px each) */
export const PIXELS_PER_HOUR = 80;

/** Height of one 15-minute slot (20px). */
export const SLOT_HEIGHT = (MINUTES_STEP / 60) * PIXELS_PER_HOUR;
