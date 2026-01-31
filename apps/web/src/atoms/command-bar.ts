import { atom } from "jotai";

/**
 * Controls whether the command bar dialog is open.
 */
export const commandBarOpenAtom = atom(false);

/**
 * Tracks the task ID that should be focused/opened for editing.
 * Set this when selecting a task from command bar search.
 * TaskEditPopover components check this and open when their task ID matches.
 * Cleared when the popover closes.
 */
export const focusedTaskIdAtom = atom<string | null>(null);
