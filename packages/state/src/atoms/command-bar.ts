import { atom } from "jotai";
import type { CommandBarTaskOpenRequest } from "../task-search-routing";

/**
 * Controls whether the command bar dialog is open.
 */
export const commandBarOpenAtom = atom(false);

/**
 * Tracks the task open request that should be handled by the matching surface.
 */
export const commandBarTaskOpenRequestAtom =
  atom<CommandBarTaskOpenRequest | null>(null);
