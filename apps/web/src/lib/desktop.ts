"use client";

import type { DesktopBridge } from "@kompose/desktop";

export function isDesktopRuntime() {
  return typeof window !== "undefined" && !!window.komposeDesktop;
}
export function desktopBridge(): DesktopBridge {
  if (typeof window === "undefined" || !window.komposeDesktop) {
    throw new Error("Desktop integration is unavailable.");
  }
  return window.komposeDesktop;
}
