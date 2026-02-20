"use client";

interface AuthErrorResult {
  error?: {
    message?: string | null;
    statusText?: string | null;
  } | null;
}

export type DesktopCommandBarShortcutPresetId =
  | "cmd_or_ctrl_shift_k"
  | "ctrl_space"
  | "alt_space";

export interface DesktopCommandBarShortcutPreset {
  accelerator: string;
  id: DesktopCommandBarShortcutPresetId;
  label: string;
}

export const desktopCommandBarShortcutPresets: readonly DesktopCommandBarShortcutPreset[] =
  [
    {
      id: "cmd_or_ctrl_shift_k",
      label: "Cmd/Ctrl + Shift + K",
      accelerator: "CommandOrControl+Shift+K",
    },
    {
      id: "ctrl_space",
      label: "Ctrl + Space",
      accelerator: "Control+Space",
    },
    {
      id: "alt_space",
      label: "Alt/Option + Space",
      accelerator: "Alt+Space",
    },
  ] as const;

const DEFAULT_DESKTOP_COMMAND_BAR_SHORTCUT_PRESET_ID: DesktopCommandBarShortcutPresetId =
  "cmd_or_ctrl_shift_k";
const DESKTOP_SETTINGS_STORE_FILE = "desktop-settings.json";
const COMMAND_BAR_SHORTCUT_PRESET_STORE_KEY = "command-bar-shortcut-preset-id";

function isDesktopCommandBarShortcutPresetId(
  value: string
): value is DesktopCommandBarShortcutPresetId {
  return desktopCommandBarShortcutPresets.some((preset) => preset.id === value);
}

// Detect whether code runs inside a Tauri WebView.
export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
    // Generate a one-time token tied to the current session. The bearer
    // token is sent automatically via the Authorization header.
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

/**
 * Read the persisted desktop command bar shortcut preset.
 */
export async function getDesktopCommandBarShortcutPresetId(): Promise<DesktopCommandBarShortcutPresetId> {
  if (!isTauriRuntime()) {
    return DEFAULT_DESKTOP_COMMAND_BAR_SHORTCUT_PRESET_ID;
  }

  try {
    const store = await getDesktopSettingsStore();
    const storedPreset = await store.get<string>(
      COMMAND_BAR_SHORTCUT_PRESET_STORE_KEY
    );
    if (
      typeof storedPreset === "string" &&
      isDesktopCommandBarShortcutPresetId(storedPreset)
    ) {
      return storedPreset;
    }
  } catch (error) {
    console.warn(
      "[getDesktopCommandBarShortcutPresetId] Failed to read preset:",
      error
    );
  }

  return DEFAULT_DESKTOP_COMMAND_BAR_SHORTCUT_PRESET_ID;
}

/**
 * Persist the desktop command bar shortcut preset.
 */
export async function setDesktopCommandBarShortcutPresetId(
  presetId: DesktopCommandBarShortcutPresetId
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const store = await getDesktopSettingsStore();
  await store.set(COMMAND_BAR_SHORTCUT_PRESET_STORE_KEY, presetId);
  await store.save();
}

/**
 * Apply a command bar shortcut preset by invoking the desktop command.
 */
export async function applyDesktopCommandBarShortcutPreset(
  presetId: DesktopCommandBarShortcutPresetId
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_command_bar_shortcut_preset", {
    presetId,
  });
}

/**
 * Load the persisted preset and apply it at runtime.
 */
export async function syncDesktopCommandBarShortcutPreset(): Promise<DesktopCommandBarShortcutPresetId> {
  const presetId = await getDesktopCommandBarShortcutPresetId();
  await applyDesktopCommandBarShortcutPreset(presetId);
  return presetId;
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

/** Lazily import and return the desktop settings store. */
async function getDesktopSettingsStore() {
  const { LazyStore } = await import("@tauri-apps/plugin-store");
  return new LazyStore(DESKTOP_SETTINGS_STORE_FILE);
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
