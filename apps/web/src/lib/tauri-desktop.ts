"use client";

interface AuthErrorResult {
  error?: {
    message?: string | null;
    statusText?: string | null;
  } | null;
}

// Detect whether code runs inside a Tauri WebView.
export function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  // Bundled desktop app serves from tauri://localhost.
  if (window.location.protocol === "tauri:") {
    return true;
  }

  // Tauri dev serves from http(s), but includes a UA marker.
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Tauri")
  ) {
    return true;
  }

  // Backward-compatible global checks.
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

// Parse Better Auth error payloads robustly across methods.
export function extractAuthErrorMessage(result: unknown) {
  if (typeof result !== "object" || result === null) {
    return null;
  }
  const typedResult = result as AuthErrorResult;
  const message = typedResult.error?.message;
  if (typeof message === "string" && message.length > 0) {
    return message;
  }
  const statusText = typedResult.error?.statusText;
  if (typeof statusText === "string" && statusText.length > 0) {
    return statusText;
  }
  return null;
}

// Open URL in system browser when available.
export async function openUrlInDesktopBrowser(url: string) {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

// Return external http(s) URL for interception; null for internal/non-http links.
export function getExternalHttpUrl(href: string, currentOrigin: string) {
  try {
    const url = new URL(href, currentOrigin);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    if (!isHttp) {
      return null;
    }
    if (url.origin === currentOrigin) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
