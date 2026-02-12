import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/**
 * Shared desktop widths for the dashboard sidebars.
 * clamp(min, preferred viewport width, max) keeps layouts responsive.
 */
export const SIDEBAR_LEFT_WIDTH = "clamp(18rem, 22vw, 22rem)";
export const SIDEBAR_RIGHT_WIDTH = "clamp(24rem, 30vw, 30rem)";

/**
 * Width-budget constants used for responsive layout calculations.
 * Keep these in px so breakpoints are deterministic.
 */
export const SIDEBAR_LEFT_MIN_WIDTH_PX = 288; // 18rem
export const SIDEBAR_LEFT_ICON_WIDTH_PX = 48; // 3rem
export const SIDEBAR_RIGHT_MIN_WIDTH_PX = 352; // 24rem
export const CALENDAR_TIME_GUTTER_WIDTH_PX = 48; // w-16
export const CALENDAR_DAY_MIN_WIDTH_PX = 138;
export const MIN_DAYS_WHEN_RIGHT_DOCKED = 3;

export interface DashboardResponsiveLayout {
  canDockRightSidebar: boolean;
  canShowCalendar: boolean;
  maxDaysWithDockedRight: number;
  maxDaysWithoutRightSidebar: number;
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
 * The result drives day clamping and docked-vs-overlay right sidebar behavior.
 */
export function computeDashboardResponsiveLayout(args: {
  leftSidebarOpen: boolean;
  rightSidebarDockRequested: boolean;
  viewportWidth: number;
}): DashboardResponsiveLayout {
  const leftSidebarWidth = args.leftSidebarOpen
    ? SIDEBAR_LEFT_MIN_WIDTH_PX
    : SIDEBAR_LEFT_ICON_WIDTH_PX;

  const mainRegionWidth = Math.max(0, args.viewportWidth - leftSidebarWidth);
  const maxDaysWithoutRightSidebar = getCalendarDayCapacity(mainRegionWidth);
  const maxDaysWithDockedRight = getCalendarDayCapacity(
    mainRegionWidth - SIDEBAR_RIGHT_MIN_WIDTH_PX
  );

  const canShowCalendar = maxDaysWithoutRightSidebar >= 1;
  const canDockRightSidebar =
    maxDaysWithDockedRight >= MIN_DAYS_WHEN_RIGHT_DOCKED;
  const isDockedRightSidebarActive =
    args.rightSidebarDockRequested && canDockRightSidebar;

  return {
    canDockRightSidebar,
    canShowCalendar,
    maxDaysWithDockedRight,
    maxDaysWithoutRightSidebar,
    maxDaysForCurrentLayout: isDockedRightSidebarActive
      ? maxDaysWithDockedRight
      : maxDaysWithoutRightSidebar,
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

/**
 * Current viewport width for dashboard responsive calculations.
 * Populated client-side from the dashboard layout.
 */
export const dashboardViewportWidthAtom = atom(0);

/**
 * Overlay-only open state for right chat in constrained widths.
 */
export const sidebarRightOverlayOpenAtom = atom(false);

/**
 * Derived responsive flags/capacity used across layout, page, and hotkeys.
 */
export const dashboardResponsiveLayoutAtom = atom((get) =>
  computeDashboardResponsiveLayout({
    leftSidebarOpen: get(sidebarLeftOpenAtom),
    rightSidebarDockRequested: get(sidebarRightOpenAtom),
    viewportWidth: get(dashboardViewportWidthAtom),
  })
);
