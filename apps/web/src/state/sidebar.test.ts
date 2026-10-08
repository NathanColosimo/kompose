import { expect, test } from "bun:test";
import { visibleDaysCountAtom } from "@kompose/state/atoms/current-date";
import { createStore } from "jotai";
import {
  computeDashboardResponsiveLayout,
  dashboardViewportWidthAtom,
  effectiveVisibleDaysCountAtom,
  sidebarLeftOpenAtom,
  sidebarRightOpenAtom,
} from "./sidebar";

test("day capacity accounts for the real gutter and clamped sidebar width", () => {
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: true,
      rightSidebarDockRequested: false,
      viewportWidth: 1039,
    }).maxDaysForCurrentLayout
  ).toBe(4);
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: true,
      rightSidebarDockRequested: false,
      viewportWidth: 1330,
    }).maxDaysForCurrentLayout
  ).toBe(7);
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: true,
      rightSidebarDockRequested: false,
      viewportWidth: 1660,
    }).maxDaysForCurrentLayout
  ).toBe(9);
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: false,
      rightSidebarDockRequested: false,
      viewportWidth: 1039,
    }).maxDaysForCurrentLayout
  ).toBe(6);
});

test("the navigation period tracks rendered days without changing the preferred view", () => {
  const store = createStore();
  store.set(visibleDaysCountAtom, 7);
  store.set(sidebarLeftOpenAtom, true);
  store.set(sidebarRightOpenAtom, false);
  store.set(dashboardViewportWidthAtom, 1280);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(6);
  store.set(dashboardViewportWidthAtom, 720);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(2);
  store.set(sidebarLeftOpenAtom, false);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(4);
  store.set(dashboardViewportWidthAtom, 1920);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(7);
  expect(store.get(visibleDaysCountAtom)).toBe(7);
  store.set(visibleDaysCountAtom, 3);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(3);
});

test("the empty right sidebar reserves its actual width and overlays when space is tight", () => {
  const store = createStore();
  store.set(visibleDaysCountAtom, 7);
  store.set(sidebarLeftOpenAtom, true);
  store.set(sidebarRightOpenAtom, true);
  store.set(dashboardViewportWidthAtom, 1280);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(3);
  store.set(dashboardViewportWidthAtom, 1330);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(4);
  store.set(dashboardViewportWidthAtom, 1920);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(7);
  store.set(dashboardViewportWidthAtom, 1100);
  expect(store.get(effectiveVisibleDaysCountAtom)).toBe(5);
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: true,
      rightSidebarDockRequested: true,
      viewportWidth: 1100,
    }).canDockRightSidebar
  ).toBe(false);
  expect(store.get(visibleDaysCountAtom)).toBe(7);
});
