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

/**
 * Open the system browser to initiate an OAuth flow for Tauri desktop.
 *
 * For sign-in: opens the desktop-sign-in endpoint directly.
 * For linking: generates a one-time token via the Better Auth client plugin,
 * then opens the desktop-sign-in endpoint with that token.
 *
 * @param provider - OAuth provider name (e.g. "google", "apple")
 * @param mode - "sign-in" (default) or "link" for account linking
 * @param baseUrl - The server base URL (NEXT_PUBLIC_WEB_URL)
 */
export async function openDesktopOAuth(
  provider: string,
  mode: "sign-in" | "link",
  baseUrl: string
) {
  const signInUrl = new URL("/api/auth/desktop-sign-in", baseUrl);
  signInUrl.searchParams.set("provider", provider);

  if (mode === "link") {
    // Generate a one-time token tied to the current session via the
    // Better Auth oneTimeToken client plugin. The session cookie is
    // sent automatically by the webview.
    const { authClient } = await import("@/lib/auth-client");
    const { data, error } = await authClient.oneTimeToken.generate();

    if (error || !data?.token) {
      throw new Error("Failed to create link token. Please try again.");
    }

    signInUrl.searchParams.set("mode", "link");
    signInUrl.searchParams.set("link_token", data.token);
  }

  await openUrlInDesktopBrowser(signInUrl.toString());
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
