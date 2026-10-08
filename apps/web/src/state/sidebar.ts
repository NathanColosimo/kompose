import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/**
 * Base views available in the left sidebar.
 */
export type SidebarLeftBaseViewId = "inbox" | "today";

/**
 * Persisted selection for the left sidebar.
 * Tag selections store only the tag id and rehydrate against live tag data.
 */
type SidebarLeftViewSelection =
  | { type: "base"; id: SidebarLeftBaseViewId }
  | { type: "tag"; tagId: string };

/**
 * Default left-sidebar selection for first load and stale-storage fallback.
 */
export const defaultSidebarLeftViewSelection: SidebarLeftViewSelection = {
  id: "inbox",
  type: "base",
};

/**
 * Shared desktop widths for the dashboard sidebars.
 * clamp(min, preferred viewport width, max) keeps layouts responsive.
 */
export const SIDEBAR_LEFT_WIDTH = "clamp(18rem, 22vw, 22rem)";

/**
 * Width-budget constants used for responsive layout calculations.
 * Keep these in px so breakpoints are deterministic.
 */
const SIDEBAR_LEFT_MIN_WIDTH_PX = 288; // 18rem
const SIDEBAR_LEFT_ICON_WIDTH_PX = 48; // 3rem
const CALENDAR_TIME_GUTTER_WIDTH_PX = 48; // w-16
const CALENDAR_DAY_MIN_WIDTH_PX = 138;

interface DashboardResponsiveLayout {
  maxDaysForCurrentLayout: number;
}

function toNonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function getCalendarDayCapacity(calendarRegionWidthPx: number) {
  const usableWidth = calendarRegionWidthPx - CALENDAR_TIME_GUTTER_WIDTH_PX;
  return toNonNegativeInteger(usableWidth / CALENDAR_DAY_MIN_WIDTH_PX);
}

/**
 * Compute calendar/day capacity from a viewport width budget.
 * The result drives the number of visible calendar days.
 */
function computeDashboardResponsiveLayout(args: {
  leftSidebarOpen: boolean;
  viewportWidth: number;
}): DashboardResponsiveLayout {
  const leftSidebarWidth = args.leftSidebarOpen
    ? SIDEBAR_LEFT_MIN_WIDTH_PX
    : SIDEBAR_LEFT_ICON_WIDTH_PX;

  const mainRegionWidth = Math.max(0, args.viewportWidth - leftSidebarWidth);
  return {
    maxDaysForCurrentLayout: Math.max(
      1,
      getCalendarDayCapacity(mainRegionWidth)
    ),
  };
}

/**
 * Left sidebar open/closed state persisted to localStorage.
 * Defaults to true (open) for new users.
 */
export const sidebarLeftOpenAtom = atomWithStorage<boolean>(
  "sidebar-left-open",
  true,
  undefined,
  // Keep the first client render aligned with SSR, then hydrate from storage.
  { getOnInit: false }
);

/**
 * Selected left-sidebar view persisted to localStorage.
 * Defaults to the Inbox view for new users.
 */
export const sidebarLeftViewSelectionAtom =
  atomWithStorage<SidebarLeftViewSelection>(
    "sidebar-left-view-selection",
    defaultSidebarLeftViewSelection,
    undefined,
    // Keep the first client render aligned with SSR, then hydrate from storage.
    { getOnInit: false }
  );

function getInitialDashboardViewportWidth() {
  // Start from a deterministic SSR-safe width and measure after mount.
  return 0;
}

/**
 * Current viewport width for dashboard responsive calculations.
 * Populated client-side from the dashboard layout.
 */
export const dashboardViewportWidthAtom = atom(
  getInitialDashboardViewportWidth()
);

/**
 * Derived responsive flags/capacity used across layout, page, and hotkeys.
 */
export const dashboardResponsiveLayoutAtom = atom((get) =>
  computeDashboardResponsiveLayout({
    leftSidebarOpen: get(sidebarLeftOpenAtom),
    viewportWidth: get(dashboardViewportWidthAtom),
  })
);
