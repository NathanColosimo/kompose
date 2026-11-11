import {
  currentDateAtom,
  visibleDaysCountAtom,
} from "@kompose/state/atoms/current-date";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type SidebarLeftBaseViewId = "inbox" | "today";

/**
 * Persisted selection for the left sidebar.
 * Tag selections store only the tag id and rehydrate against live tag data.
 */
type SidebarLeftViewSelection =
  | { type: "base"; id: SidebarLeftBaseViewId }
  | { type: "tag"; tagId: string };

/** Also used when a persisted tag selection no longer exists. */
export const defaultSidebarLeftViewSelection: SidebarLeftViewSelection = {
  id: "inbox",
  type: "base",
};

/** Keep the CSS widths and the calendar's pixel budget derived from the same limits. */
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
function computeDashboardResponsiveLayout(args: {
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

function getInitialDashboardViewportWidth() {
  // Start from a deterministic SSR-safe width and measure after mount.
  return 0;
}

/** Measured by the dashboard layout after mount. */
export const dashboardViewportWidthAtom = atom(
  getInitialDashboardViewportWidth()
);

/** The saved choice, from wide windows only. */
const sidebarLeftPreferenceAtom = atomWithStorage<boolean>(
  "sidebar-left-open",
  true,
  undefined,
  // All persisted sidebar atoms hydrate after mount to match SSR on the first render.
  { getOnInit: false }
);

/** Below this width the task panel folds to its icon strip (Tailwind's md). */
const NARROW_VIEWPORT_PX = 768;

export const isNarrowViewportAtom = atom((get) => {
  const width = get(dashboardViewportWidthAtom);
  return width > 0 && width < NARROW_VIEWPORT_PX;
});

/**
 * Whether the panel is open while the window is narrow. It isn't saved, and
 * resets to folded each time the window narrows (see the dashboard layout).
 */
export const sidebarLeftNarrowOpenAtom = atom(false);

/**
 * The task panel's open state. In a narrow window it folds without touching
 * the saved choice, so widening again (or another tab) keeps that choice.
 */
export const sidebarLeftOpenAtom = atom(
  (get) =>
    get(isNarrowViewportAtom)
      ? get(sidebarLeftNarrowOpenAtom)
      : get(sidebarLeftPreferenceAtom),
  (get, set, update: boolean | ((open: boolean) => boolean)) => {
    const target = get(isNarrowViewportAtom)
      ? sidebarLeftNarrowOpenAtom
      : sidebarLeftPreferenceAtom;
    set(target, typeof update === "function" ? update(get(target)) : update);
  }
);

export const sidebarLeftViewSelectionAtom =
  atomWithStorage<SidebarLeftViewSelection>(
    "sidebar-left-view-selection",
    defaultSidebarLeftViewSelection,
    undefined,
    { getOnInit: false }
  );

// The right sidebar has no content yet, so it starts closed.
export const sidebarRightDockRequestedAtom = atomWithStorage<boolean>(
  "sidebar-right-open",
  false,
  undefined,
  { getOnInit: false }
);

export const dashboardResponsiveLayoutAtom = atom((get) =>
  computeDashboardResponsiveLayout({
    leftSidebarOpen: get(sidebarLeftOpenAtom),
    rightSidebarDockRequested: get(sidebarRightDockRequestedAtom),
    viewportWidth: get(dashboardViewportWidthAtom),
  })
);

const canDockRightSidebarAtom = atom(
  (get) => get(dashboardResponsiveLayoutAtom).canDockRightSidebar
);

// Each constrained-width session gets its own transient intent. Becoming dock-capable
// discards that session through derivation, without writing atoms or persisted storage.
const sidebarRightOverlaySessionAtom = atom((get) =>
  get(canDockRightSidebarAtom) ? null : atom(false)
);

type SidebarRightView = "closed" | "docked" | "overlay";

export const sidebarRightViewAtom = atom<SidebarRightView>((get) => {
  const overlayRequestedAtom = get(sidebarRightOverlaySessionAtom);
  if (overlayRequestedAtom) {
    return get(overlayRequestedAtom) ? "overlay" : "closed";
  }
  return get(sidebarRightDockRequestedAtom) ? "docked" : "closed";
});

/** Omit open to toggle; explicit values let the synchronized sidebar hotkey share it. */
export const toggleSidebarRightAtom = atom(null, (get, set, open?: boolean) => {
  const nextOpen = open ?? get(sidebarRightViewAtom) === "closed";
  const overlayRequestedAtom = get(sidebarRightOverlaySessionAtom);
  if (overlayRequestedAtom) {
    set(overlayRequestedAtom, nextOpen);
    return;
  }
  set(sidebarRightDockRequestedAtom, nextOpen);
});

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

export const effectiveVisibleDaysAtom = atom((get) => {
  const start = get(currentDateAtom);
  return Array.from({ length: get(effectiveVisibleDaysCountAtom) }, (_, i) =>
    start.add({ days: i })
  );
});
