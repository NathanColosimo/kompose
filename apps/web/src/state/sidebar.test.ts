import { expect, test } from "bun:test";
import { computeDashboardResponsiveLayout } from "./sidebar";

test("day capacity accounts for the real gutter and clamped sidebar width", () => {
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: true,
      viewportWidth: 1039,
    }).maxDaysForCurrentLayout
  ).toBe(4);
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: true,
      viewportWidth: 1330,
    }).maxDaysForCurrentLayout
  ).toBe(7);
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: true,
      viewportWidth: 1660,
    }).maxDaysForCurrentLayout
  ).toBe(9);
  expect(
    computeDashboardResponsiveLayout({
      leftSidebarOpen: false,
      viewportWidth: 1039,
    }).maxDaysForCurrentLayout
  ).toBe(6);
});
