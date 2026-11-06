/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { createStore } from "jotai";
import {
  dashboardResponsiveLayoutAtom,
  dashboardViewportWidthAtom,
  sidebarLeftOpenAtom,
  sidebarRightDockRequestedAtom,
  sidebarRightViewAtom,
  toggleSidebarRightAtom,
} from "./sidebar";

describe("right sidebar view", () => {
  test("restores the saved dock intent after shrinking and widening", () => {
    const store = createStore();
    store.set(dashboardViewportWidthAtom, 1600);
    expect(store.get(sidebarRightViewAtom)).toBe("docked");

    store.set(dashboardViewportWidthAtom, 900);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
    expect(store.get(sidebarRightDockRequestedAtom)).toBe(true);

    store.set(dashboardViewportWidthAtom, 1600);
    expect(store.get(sidebarRightViewAtom)).toBe("docked");
  });

  test("keeps a closed dock preference across resizes and overlay toggles", () => {
    const store = createStore();
    store.set(sidebarRightDockRequestedAtom, false);
    store.set(dashboardViewportWidthAtom, 900);
    store.set(toggleSidebarRightAtom);
    expect(store.get(sidebarRightViewAtom)).toBe("overlay");
    expect(store.get(sidebarRightDockRequestedAtom)).toBe(false);

    store.set(dashboardViewportWidthAtom, 1600);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
    store.set(dashboardViewportWidthAtom, 900);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
  });

  test("keeps the overlay open within a constrained session until closed", () => {
    const store = createStore();
    store.set(dashboardViewportWidthAtom, 900);
    store.set(toggleSidebarRightAtom);
    store.set(dashboardViewportWidthAtom, 950);
    expect(store.get(sidebarRightViewAtom)).toBe("overlay");
    store.set(toggleSidebarRightAtom);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
    store.set(dashboardViewportWidthAtom, 920);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
    expect(store.get(sidebarRightDockRequestedAtom)).toBe(true);
  });

  test("expires overlay intent when docking becomes possible", () => {
    const store = createStore();
    const views: string[] = [];
    const unsubscribe = store.sub(sidebarRightViewAtom, () => {
      views.push(store.get(sidebarRightViewAtom));
    });
    try {
      store.set(dashboardViewportWidthAtom, 900);
      store.set(toggleSidebarRightAtom);
      expect(store.get(sidebarRightViewAtom)).toBe("overlay");
      store.set(dashboardViewportWidthAtom, 1600);
      expect(store.get(sidebarRightViewAtom)).toBe("docked");
      store.set(dashboardViewportWidthAtom, 900);
      expect(store.get(sidebarRightViewAtom)).toBe("closed");
      expect(views).toEqual(["overlay", "docked", "closed"]);
    } finally {
      unsubscribe();
    }
  });

  test("left sidebar capacity changes also expire overlay intent", () => {
    const store = createStore();
    store.set(dashboardViewportWidthAtom, 1000);
    store.set(toggleSidebarRightAtom);
    expect(store.get(sidebarRightViewAtom)).toBe("overlay");
    store.set(sidebarLeftOpenAtom, false);
    expect(store.get(sidebarRightViewAtom)).toBe("docked");
    store.set(sidebarLeftOpenAtom, true);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
  });

  test("shares explicit open/close and toggle behavior with the calendar budget", () => {
    const store = createStore();
    store.set(dashboardViewportWidthAtom, 1600);
    store.set(toggleSidebarRightAtom, false);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
    expect(
      store.get(dashboardResponsiveLayoutAtom).maxDaysForCurrentLayout
    ).toBe(store.get(dashboardResponsiveLayoutAtom).maxDaysWithoutRightSidebar);
    store.set(toggleSidebarRightAtom);
    expect(store.get(sidebarRightViewAtom)).toBe("docked");
    expect(
      store.get(dashboardResponsiveLayoutAtom).maxDaysForCurrentLayout
    ).toBe(store.get(dashboardResponsiveLayoutAtom).maxDaysWithDockedRight);

    store.set(dashboardViewportWidthAtom, 900);
    store.set(toggleSidebarRightAtom, true);
    store.set(toggleSidebarRightAtom, true);
    expect(store.get(sidebarRightViewAtom)).toBe("overlay");
    store.set(toggleSidebarRightAtom, false);
    expect(store.get(sidebarRightViewAtom)).toBe("closed");
    expect(store.get(sidebarRightDockRequestedAtom)).toBe(true);
  });

  test("resizing never writes the persisted dock preference", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window"
    );
    const writes: { key: string; value: string }[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: (key: string, value: string) => writes.push({ key, value }),
        },
      },
    });
    try {
      const store = createStore();
      store.set(dashboardViewportWidthAtom, 1600);
      store.set(toggleSidebarRightAtom, false);
      expect(writes).toEqual([{ key: "sidebar-right-open", value: "false" }]);
      writes.length = 0;

      store.set(dashboardViewportWidthAtom, 900);
      expect(store.get(sidebarRightViewAtom)).toBe("closed");
      store.set(toggleSidebarRightAtom);
      expect(store.get(sidebarRightViewAtom)).toBe("overlay");
      store.set(dashboardViewportWidthAtom, 1600);
      expect(store.get(sidebarRightViewAtom)).toBe("closed");
      store.set(dashboardViewportWidthAtom, 900);
      expect(store.get(sidebarRightViewAtom)).toBe("closed");
      expect(writes).toEqual([]);
    } finally {
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});
