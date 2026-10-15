import { visibleDaysCountAtom } from "@kompose/state/atoms/current-date";
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
 * clamp(min, preferred viewport width, max) keeps layouts responsive. The CSS
 * value and the layout budget below are both derived from these definitions.
 */
interface ClampedWidth {
  maxRem: number;
  minRem: number;
  vw: number;
}
const SIDEBAR_LEFT: ClampedWidth = { maxRem: 22, minRem: 18, vw: 22 };
const SIDEBAR_RIGHT: ClampedWidth = { maxRem: 30, minRem: 24, vw: 30 };
const REM_PX = 16;

function toCssClamp({ maxRem, minRem, vw }: ClampedWidth) {
  return `clamp(${minRem}rem, ${vw}vw, ${maxRem}rem)`;
}
function resolveClampPx(
  { maxRem, minRem, vw }: ClampedWidth,
  viewportWidth: number
) {
  return Math.min(
    maxRem * REM_PX,
    Math.max(minRem * REM_PX, (viewportWidth * vw) / 100)
  );
}

export const SIDEBAR_LEFT_WIDTH = toCssClamp(SIDEBAR_LEFT);
export const SIDEBAR_RIGHT_WIDTH = toCssClamp(SIDEBAR_RIGHT);

/**
 * Width-budget constants used for responsive layout calculations.
 * Keep these in px so breakpoints are deterministic.
 */
const SIDEBAR_LEFT_ICON_WIDTH_PX = 48; // 3rem
const CALENDAR_TIME_GUTTER_WIDTH_PX = 64; // w-16
const CALENDAR_DAY_MIN_WIDTH_PX = 138;
const MIN_DAYS_WHEN_RIGHT_DOCKED = 3;

interface DashboardResponsiveLayout {
  canDockRightSidebar: boolean;
  maxDaysForCurrentLayout: number;
  maxDaysWithDockedRight: number;
  maxDaysWithoutRightSidebar: number;
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
    ? resolveClampPx(SIDEBAR_LEFT, args.viewportWidth)
    : SIDEBAR_LEFT_ICON_WIDTH_PX;

  const mainRegionWidth = Math.max(0, args.viewportWidth - leftSidebarWidth);
  const maxDaysWithoutRightSidebar = getCalendarDayCapacity(mainRegionWidth);
  const rightSidebarWidth = resolveClampPx(SIDEBAR_RIGHT, args.viewportWidth);
  const maxDaysWithDockedRight = getCalendarDayCapacity(
    mainRegionWidth - rightSidebarWidth
  );

  const canDockRightSidebar =
    maxDaysWithDockedRight >= MIN_DAYS_WHEN_RIGHT_DOCKED;
  const isDockedRightSidebarActive =
    args.rightSidebarDockRequested && canDockRightSidebar;
  const maxDaysForCurrentLayout = Math.max(
    1,
    isDockedRightSidebarActive
      ? maxDaysWithDockedRight
      : maxDaysWithoutRightSidebar
  );

  return {
    canDockRightSidebar,
    maxDaysForCurrentLayout,
    maxDaysWithDockedRight,
    maxDaysWithoutRightSidebar,
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

/**
 * Right sidebar open/closed state persisted to localStorage.
 * Defaults to true (open) for new users.
 */
export const sidebarRightOpenAtom = atomWithStorage<boolean>(
  "sidebar-right-open",
  true,
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
 * Overlay-only open state for right sidebar in constrained widths.
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

/** Rendered days and every period-navigation control must share this count. */
export const effectiveVisibleDaysCountAtom = atom((get) =>
  Math.max(
    1,
    Math.min(
      get(visibleDaysCountAtom),
      get(dashboardResponsiveLayoutAtom).maxDaysForCurrentLayout
    )
  )
);
