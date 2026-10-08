"use client";

import {
  DESKTOP_ORIGIN,
  type DesktopBridge,
  type DesktopCommandBarShortcutPresetId,
} from "@kompose/desktop";

export function isDesktopRuntime() {
  return typeof window !== "undefined" && !!window.komposeDesktop;
}
export function desktopBridge(): DesktopBridge {
  if (typeof window === "undefined" || !window.komposeDesktop) {
    throw new Error("Desktop integration is unavailable.");
  }
  return window.komposeDesktop;
}
/** Preserve streaming responses and AbortSignals while the main process adds auth. */
export function desktopFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (!url.pathname.startsWith("/api/")) {
    throw new Error("Unsupported desktop API path");
  }
  const destination = `${DESKTOP_ORIGIN}${url.pathname}${url.search}`;
  return fetch(
    input instanceof Request ? new Request(destination, input) : destination,
    init
  );
}
export function extractAuthErrorMessage(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return null;
  }
  const error = result.error as {
    message?: string;
    statusText?: string;
  } | null;
  return error?.message || error?.statusText || null;
}
export async function openUrlInDesktopBrowser(url: string) {
  if (isDesktopRuntime()) {
    await desktopBridge().openExternal(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
export function getDesktopCommandBarShortcutPresetId(): Promise<DesktopCommandBarShortcutPresetId> {
  return isDesktopRuntime()
    ? desktopBridge().getShortcut()
    : Promise.resolve("cmd_or_ctrl_shift_k");
}
export async function applyDesktopCommandBarShortcutPreset(
  id: DesktopCommandBarShortcutPresetId
) {
  await desktopBridge().setShortcut(id);
}
export function getExternalHttpUrl(href: string, currentOrigin: string) {
  try {
    const url = new URL(href, currentOrigin);
    return ["http:", "https:"].includes(url.protocol) &&
      url.origin !== currentOrigin
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
