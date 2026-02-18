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

// ---------------------------------------------------------------------------
// Bearer token storage for Tauri desktop.
// The Tauri webview cannot use cookies cross-origin (WKWebView ITP blocks
// Set-Cookie), so it authenticates via a bearer token. The token is kept in
// an in-memory variable for synchronous reads (required by Better Auth's
// fetchOptions.auth.token callback) and persisted to Tauri Store (app data
// directory, accessed via Rust IPC) for cross-launch persistence.
// ---------------------------------------------------------------------------

const BEARER_STORE_KEY = "bearer-token";

/** In-memory cache so `getTauriBearer()` can return synchronously. */
let bearerCache = "";

/** Read the bearer token synchronously from the in-memory cache. */
export function getTauriBearer(): string {
  return bearerCache;
}

/**
 * Persist a bearer token received from the server's `set-auth-token` header.
 * Updates the in-memory cache immediately and writes to Tauri Store async.
 */
export function setTauriBearer(token: string) {
  bearerCache = token;
  persistToStore(token);
}

/** Clear the bearer token on logout. */
export function clearTauriBearer() {
  bearerCache = "";
  removeFromStore();
}

/**
 * Load the bearer token from Tauri Store into the in-memory cache.
 * Must be called once on app startup BEFORE any auth requests fire.
 */
export async function initTauriBearer(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    const store = await getTauriStore();
    const token = await store.get<string>(BEARER_STORE_KEY);
    if (token) {
      bearerCache = token;
    }
  } catch (error) {
    console.warn("[initTauriBearer] Failed to load token from store:", error);
  }
}

/** Lazily import and return a Tauri LazyStore instance. */
async function getTauriStore() {
  const { LazyStore } = await import("@tauri-apps/plugin-store");
  return new LazyStore("auth.json");
}

/** Write the token to Tauri Store (fire-and-forget). */
function persistToStore(token: string) {
  if (!isTauriRuntime()) {
    return;
  }
  getTauriStore()
    .then(async (store) => {
      await store.set(BEARER_STORE_KEY, token);
      await store.save();
    })
    .catch((error) => {
      console.warn("[setTauriBearer] Failed to persist token:", error);
    });
}

/** Remove the token from Tauri Store (fire-and-forget). */
function removeFromStore() {
  if (!isTauriRuntime()) {
    return;
  }
  getTauriStore()
    .then(async (store) => {
      await store.delete(BEARER_STORE_KEY);
      await store.save();
    })
    .catch((error) => {
      console.warn("[clearTauriBearer] Failed to remove token:", error);
    });
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
