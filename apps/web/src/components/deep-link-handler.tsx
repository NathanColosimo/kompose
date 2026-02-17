"use client";

import { env } from "@kompose/env";
import { useCallback, useEffect, useRef } from "react";
import { isTauriRuntime } from "@/lib/tauri-desktop";

/**
 * localStorage key for tracking processed tokens. Uses localStorage (not
 * sessionStorage) because the verify flow navigates the webview cross-origin
 * to kompose.dev and back — sessionStorage would be lost on origin change.
 */
const PROCESSED_TOKENS_KEY = "kompose:deep-link-processed-tokens";

/** Record a token so subsequent getCurrent() calls won't re-process it. */
function markTokenProcessed(token: string) {
  try {
    const raw = localStorage.getItem(PROCESSED_TOKENS_KEY);
    const set: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    set.push(token);
    // Cap at 20 entries to avoid unbounded growth.
    if (set.length > 20) {
      set.splice(0, set.length - 20);
    }
    localStorage.setItem(PROCESSED_TOKENS_KEY, JSON.stringify(set));
  } catch {
    // localStorage may not be available; ignore.
  }
}

function isTokenAlreadyProcessed(token: string): boolean {
  try {
    const raw = localStorage.getItem(PROCESSED_TOKENS_KEY);
    if (!raw) {
      return false;
    }
    return (JSON.parse(raw) as string[]).includes(token);
  } catch {
    return false;
  }
}

/**
 * Handles kompose:// deep link URLs in the Tauri desktop app.
 *
 * On receiving `kompose://auth/callback?token=TOKEN`, navigates the webview
 * to the server's desktop-callback verify endpoint as a **first-party page
 * load**. This bypasses Safari/WKWebView ITP which blocks Set-Cookie on
 * cross-origin fetch responses. The server sets the session cookie
 * (first-party) and redirects back to tauri://localhost/dashboard.
 */
export function DeepLinkHandler() {
  const processingRef = useRef(false);

  const handleDeepLinkUrl = useCallback((urlString: string) => {
    if (!urlString.startsWith("kompose://auth/callback")) {
      return;
    }

    if (processingRef.current) {
      return;
    }
    processingRef.current = true;

    try {
      const url = new URL(urlString);
      const token = url.searchParams.get("token");

      if (!token) {
        console.warn("[DeepLinkHandler] No token in deep link URL");
        return;
      }

      // getCurrent() can return the same URL after the webview reloads.
      // Skip tokens we have already handed off to the verify endpoint.
      if (isTokenAlreadyProcessed(token)) {
        return;
      }

      // Mark before navigating so the reload after redirect won't re-process.
      markTokenProcessed(token);

      // Navigate the webview to the server as a first-party page load.
      // The server verifies the one-time token, sets the session cookie
      // (bypasses ITP), and redirects back to tauri://localhost/dashboard.
      const verifyUrl = new URL(
        "/api/auth/desktop-callback",
        env.NEXT_PUBLIC_WEB_URL
      );
      verifyUrl.searchParams.set("verify", token);
      window.location.href = verifyUrl.toString();
    } finally {
      processingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let cleanupFn: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrent, onOpenUrl } = await import(
          "@tauri-apps/plugin-deep-link"
        );

        // Check if the app was launched via a deep link.
        const startUrls = await getCurrent();
        if (startUrls && startUrls.length > 0) {
          for (const url of startUrls) {
            handleDeepLinkUrl(url);
          }
        }

        // Listen for deep link events while the app is running.
        const unlisten = await onOpenUrl((urls) => {
          for (const url of urls) {
            handleDeepLinkUrl(url);
          }
        });

        cleanupFn = unlisten;
      } catch (error) {
        // Deep link plugin may not be available in dev mode.
        console.warn("[DeepLinkHandler] Plugin not available:", error);
      }
    };

    setup();

    return () => {
      cleanupFn?.();
    };
  }, [handleDeepLinkUrl]);

  return null;
}
