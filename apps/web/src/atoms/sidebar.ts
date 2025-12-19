import { atomWithStorage } from "jotai/utils";

/**
 * Sidebar open/closed state persisted to localStorage.
 * Defaults to true (open) for new users.
 */
export const sidebarOpenAtom = atomWithStorage<boolean>(
  "sidebar-open",
  true,
  undefined,
  { getOnInit: true }
);
