import { atom } from "jotai";

/**
 * Controls whether the command bar dialog is open.
 */
export const commandBarOpenAtom = atom(false);

/**
 * Tracks the task ID that should be focused/opened for editing.
 */
export const focusedTaskIdAtom = atom<string | null>(null);
