"use client";

import { env } from "@kompose/env";
import {
  GOOGLE_ACCOUNT_INFO_QUERY_KEY,
  GOOGLE_ACCOUNTS_QUERY_KEY,
} from "@kompose/state/google-calendar-query-keys";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { getDesktopAuthCallbackPrefix } from "@/lib/desktop-deep-link";
import { isTauriRuntime } from "@/lib/tauri-desktop";

/**
 * Module-level set of tokens claimed for processing in this app session.
 * Unlike useRef (reset on unmount) and localStorage (written after verify),
 * this survives component unmount/remount cycles and is checked synchronously
 * before the async verify call, closing the race window that allowed
 * TauriBearerInit's mount→unmount→remount cycle (or effect re-runs from
 * dependency changes) to fire a second verify on an already-consumed token.
 */
const claimedTokens = new Set<string>();

const WHOOP_ACCOUNTS_QUERY_KEY = ["whoop-accounts"] as const;
const DESKTOP_DEEP_LINK_SCHEME = env.NEXT_PUBLIC_DESKTOP_DEEP_LINK_SCHEME;
const DESKTOP_AUTH_CALLBACK_PREFIX = getDesktopAuthCallbackPrefix(
  DESKTOP_DEEP_LINK_SCHEME
);
const PROCESSED_TOKENS_KEY = `${DESKTOP_DEEP_LINK_SCHEME}:deep-link-processed-tokens`;

/** Record a token so subsequent getCurrent() calls won't re-process it. */
function markTokenProcessed(token: string) {
  const raw = localStorage.getItem(PROCESSED_TOKENS_KEY);
  const processedTokens: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  processedTokens.push(token);

  // Cap at 20 entries to avoid unbounded growth.
  if (processedTokens.length > 20) {
    processedTokens.splice(0, processedTokens.length - 20);
  }

  localStorage.setItem(PROCESSED_TOKENS_KEY, JSON.stringify(processedTokens));
}

function isTokenAlreadyProcessed(token: string): boolean {
  const raw = localStorage.getItem(PROCESSED_TOKENS_KEY);
  if (!raw) {
    return false;
  }

  return (JSON.parse(raw) as string[]).includes(token);
}

async function refreshLinkedAccountQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: GOOGLE_ACCOUNTS_QUERY_KEY,
  });
  await queryClient.invalidateQueries({
    queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY,
  });
  await queryClient.invalidateQueries({
    queryKey: WHOOP_ACCOUNTS_QUERY_KEY,
  });
}

function getLinkedAccountSuccessMessage(linkedProvider: string | null) {
  return linkedProvider === "whoop"
    ? "WHOOP account linked."
    : "Google account linked.";
}

/**
 * Handles desktop deep link URLs in the Tauri app.
 *
 * On receiving `<scheme>://auth/callback?token=TOKEN`, verifies the one-time
 * token via the Better Auth client. The bearer plugin captures the session
 * token from the `set-auth-token` response header and persists it to
 * Tauri Store (via setTauriBearer in auth-client.ts). All subsequent
 * requests use this bearer token via the Authorization header, bypassing
 * WKWebView's ITP cookie restrictions entirely.
 */
export function DeepLinkHandler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const processingRef = useRef(false);

  const handleDeepLinkUrl = useCallback(
    async (urlString: string) => {
      if (!urlString.startsWith(DESKTOP_AUTH_CALLBACK_PREFIX)) {
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

        // Deduplicate: skip tokens already verified (localStorage) or
        // currently being verified in another mount/effect cycle (module Set).
        if (isTokenAlreadyProcessed(token) || claimedTokens.has(token)) {
          return;
        }

        // Claim before the async verify so a concurrent re-mount or
        // effect re-run will see the token and bail out immediately.
        claimedTokens.add(token);

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

        const isLinkMode = url.searchParams.get("mode") === "link";
        const linkedProvider = url.searchParams.get("provider");

        if (isLinkMode) {
          await refreshLinkedAccountQueries(queryClient);
          toast.success(getLinkedAccountSuccessMessage(linkedProvider));
        } else {
          // Sign-in: invalidate everything so the dashboard refetches
          // with the freshly-stored bearer token.
          await queryClient.invalidateQueries();
          toast.success("Signed in successfully.");
          router.push("/dashboard");
        }
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
