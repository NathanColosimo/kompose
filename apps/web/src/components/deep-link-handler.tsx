"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { isTauriRuntime } from "@/lib/tauri-desktop";

/** sessionStorage key used to track tokens we have already exchanged. */
const PROCESSED_TOKENS_KEY = "kompose:deep-link-processed-tokens";

/**
 * Record a token so subsequent mounts (e.g. after a manual page reload)
 * won't try to verify it again from getCurrent().
 */
function markTokenProcessed(token: string) {
  try {
    const raw = sessionStorage.getItem(PROCESSED_TOKENS_KEY);
    const set: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    set.push(token);
    sessionStorage.setItem(PROCESSED_TOKENS_KEY, JSON.stringify(set));
  } catch {
    // sessionStorage may not be available; ignore.
  }
}

function isTokenAlreadyProcessed(token: string): boolean {
  try {
    const raw = sessionStorage.getItem(PROCESSED_TOKENS_KEY);
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
 * Listens for deep link events via @tauri-apps/plugin-deep-link and processes
 * OAuth callback URLs of the form:
 *   kompose://auth/callback?token=ONE_TIME_TOKEN
 *
 * On receiving such a URL it exchanges the one-time token for a session cookie,
 * refreshes the session state, and navigates to the dashboard.
 */
export function DeepLinkHandler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Guard against processing the same token twice (e.g. duplicate events).
  const processingRef = useRef(false);

  const handleDeepLinkUrl = useCallback(
    async (urlString: string) => {
      // Only handle auth callback deep links.
      if (!urlString.startsWith("kompose://auth/callback")) {
        return;
      }

      // Prevent concurrent processing.
      if (processingRef.current) {
        return;
      }
      processingRef.current = true;

      try {
        const url = new URL(urlString);
        const token = url.searchParams.get("token");

        if (!token) {
          console.warn("[DeepLinkHandler] No token in deep link URL");
          toast.error("Authentication failed. No token received.");
          return;
        }

        // getCurrent() persists the last deep link URL across page reloads.
        // On a manual reload the component re-mounts and getCurrent() returns
        // the same URL. Skip tokens we already verified to avoid a 401.
        if (isTokenAlreadyProcessed(token)) {
          return;
        }

        // Verify the one-time token via the Better Auth client plugin.
        // The after hook in auth config rewrites SameSite=None; Secure on
        // the response cookies for tauri://localhost cross-origin requests.
        const { error } = await authClient.oneTimeToken.verify({ token });

        // The verify response sets the session cookie at the HTTP layer.
        // The client may still report an error (e.g. cross-origin response
        // parsing), so confirm the session via getSession rather than
        // trusting the verify result alone.
        const session = await authClient.getSession({
          query: { disableCookieCache: true },
        });

        if (!session?.data?.user) {
          if (error) {
            console.error(
              "[DeepLinkHandler] Token verification failed:",
              error
            );
          }
          toast.error("Authentication failed. Please try again.");
          return;
        }

        // Remember this token so we don't re-process it after navigation.
        markTokenProcessed(token);

        // Invalidate all cached queries so the dashboard refetches session,
        // accounts, events, etc. with the freshly-set cookie.
        await queryClient.invalidateQueries();

        toast.success("Signed in successfully.");

        router.push("/dashboard");
      } catch (error) {
        console.error("[DeepLinkHandler] Error processing deep link:", error);
        toast.error("Something went wrong during sign-in.");
      } finally {
        processingRef.current = false;
      }
    },
    [router, queryClient]
  );

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
            await handleDeepLinkUrl(url);
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

  // Renderless component.
  return null;
}
