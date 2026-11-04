import { atom } from "jotai";

/** The 15-minute slot a calendar drag is over, for the column highlight. */
export const calendarDropSlotAtom = atom<{
  dayKey: string;
  index: number;
} | null>(null);
