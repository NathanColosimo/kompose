import { atom } from "jotai";
import type { CommandBarTaskOpenRequest } from "../task-search-routing";

export const commandBarOpenAtom = atom(false);

/** The matching calendar or sidebar surface consumes this request. */
export const commandBarTaskOpenRequestAtom =
  atom<CommandBarTaskOpenRequest | null>(null);
