"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { isTauriRuntime } from "@/lib/tauri-desktop";

/** localStorage key for tracking tokens we have already exchanged. */
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
 * On receiving `kompose://auth/callback?token=TOKEN`, verifies the one-time
 * token via the Better Auth client. The bearer plugin captures the session
 * token from the `set-auth-token` response header and stores it in
 * localStorage (configured globally in auth-client.ts). All subsequent
 * requests use this bearer token via the Authorization header, bypassing
 * WKWebView's ITP cookie restrictions entirely.
 */
export function DeepLinkHandler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const processingRef = useRef(false);

  const handleDeepLinkUrl = useCallback(
    async (urlString: string) => {
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
          toast.error("Authentication failed. No token received.");
          return;
        }

        // getCurrent() can return the same URL after component re-mounts.
        // Skip tokens we have already verified to avoid a 401.
        if (isTokenAlreadyProcessed(token)) {
          return;
        }

        // Verify the one-time token. The global onSuccess handler in
        // auth-client.ts captures the `set-auth-token` response header
        // and stores it in localStorage as the bearer token.
        const { error } = await authClient.oneTimeToken.verify({ token });

        if (error) {
          console.warn("[DeepLinkHandler] Token verification failed:", error);

          // The token may have expired or already been consumed, but the
          // user might still have a valid session from a previous login.
          // Check before showing an error toast.
          const session = await authClient.getSession({
            query: { disableCookieCache: true },
          });
          if (session?.data?.user) {
            await queryClient.invalidateQueries();
            router.push("/dashboard");
            return;
          }

          toast.error("Authentication failed. Please try again.");
          return;
        }

        // Remember this token so we don't re-process it.
        markTokenProcessed(token);

        // Invalidate all cached queries so the dashboard refetches with
        // the freshly-stored bearer token.
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

  return null;
}
