import { atomWithStorage } from "jotai/utils";

/**
 * Shared desktop widths for the dashboard sidebars.
 * clamp(min, preferred viewport width, max) keeps layouts responsive.
 */
export const SIDEBAR_LEFT_WIDTH = "clamp(18rem, 22vw, 22rem)";
export const SIDEBAR_RIGHT_WIDTH = "clamp(24rem, 30vw, 30rem)";

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
