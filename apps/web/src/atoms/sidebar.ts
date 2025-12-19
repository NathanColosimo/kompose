import { atomWithStorage } from "jotai/utils";

/**
 * Left sidebar open/closed state persisted to localStorage.
 * Defaults to true (open) for new users.
 */
export const sidebarLeftOpenAtom = atomWithStorage<boolean>(
  "sidebar-left-open",
  true,
  undefined,
  { getOnInit: true }
);

/**
 * Right sidebar open/closed state persisted to localStorage.
 * Defaults to true (open) for new users.
 */
export const sidebarRightOpenAtom = atomWithStorage<boolean>(
  "sidebar-right-open",
  true,
  undefined,
  { getOnInit: true }
);
