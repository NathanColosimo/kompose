"use client";

import { env } from "@kompose/env";
import { LINKED_ACCOUNTS_QUERY_KEY } from "@kompose/state/account-query-keys";
import { GOOGLE_ACCOUNT_INFO_QUERY_KEY } from "@kompose/state/google-calendar-query-keys";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import { getDesktopAuthCallbackPrefix } from "@/lib/desktop-deep-link";
import { isTauriRuntime } from "@/lib/tauri-desktop";

/**
 * Module-level in-flight set closes the gap between receiving a token and
 * persisting it as processed without permanently blocking a failed retry.
 */
const inFlightTokens = new Set<string>();
const processedTokensInSession = new Set<string>();

const DESKTOP_DEEP_LINK_SCHEME = env.NEXT_PUBLIC_DESKTOP_DEEP_LINK_SCHEME;
const DESKTOP_AUTH_CALLBACK_PREFIX = getDesktopAuthCallbackPrefix(
  DESKTOP_DEEP_LINK_SCHEME
);
const PROCESSED_TOKENS_KEY = `${DESKTOP_DEEP_LINK_SCHEME}:deep-link-processed-tokens`;
const processedTokensSchema = z.array(z.string());

function readProcessedTokens(): string[] {
  try {
    const raw = localStorage.getItem(PROCESSED_TOKENS_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    const result = processedTokensSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

/** Record a token so subsequent getCurrent() calls won't re-process it. */
function markTokenProcessed(token: string) {
  processedTokensInSession.add(token);
  const processedTokens = [...new Set([...readProcessedTokens(), token])];

  // Cap at 20 entries to avoid unbounded growth.
  if (processedTokens.length > 20) {
    processedTokens.splice(0, processedTokens.length - 20);
  }

  try {
    localStorage.setItem(PROCESSED_TOKENS_KEY, JSON.stringify(processedTokens));
  } catch {
    // Token verification already succeeded; persistence is best-effort only.
  }
}

function isTokenAlreadyProcessed(token: string): boolean {
  return (
    processedTokensInSession.has(token) || readProcessedTokens().includes(token)
  );
}

async function refreshLinkedAccountQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
  });
  await queryClient.invalidateQueries({
    queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY,
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
  const [enabled, setEnabled] = useState(false);

  useMountEffect(() => {
    setEnabled(isTauriRuntime());
  });

  return enabled ? <TauriDeepLinkHandler /> : null;
}

function TauriDeepLinkHandler() {
  const { push } = useRouter();
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = authClient.useSession();

  const handleDeepLinkUrl = useCallback(
    async (urlString: string) => {
      if (!urlString.startsWith(DESKTOP_AUTH_CALLBACK_PREFIX)) {
        return;
      }

      let token: string | null = null;
      try {
        const url = new URL(urlString);
        token = url.searchParams.get("token");

        if (!token) {
          console.warn("[DeepLinkHandler] No token in deep link URL");
          toast.error("Authentication failed. No token received.");
          return;
        }

        // Deduplicate tokens already verified or currently being verified.
        if (isTokenAlreadyProcessed(token) || inFlightTokens.has(token)) {
          return;
        }

        inFlightTokens.add(token);

        const { error } = await authClient.oneTimeToken.verify({ token });

        if (error) {
          console.warn("[DeepLinkHandler] Token verification failed:", error);

          // The token may have expired or already been consumed, but the
          // user might still have a valid session from a previous login.
          // Check before showing an error toast.
          const session = await authClient.getSession();
          if (session?.data?.user) {
            markTokenProcessed(token);
            await refetchSession();
            await queryClient.invalidateQueries();
            push("/dashboard");
            return;
          }

          toast.error("Authentication failed. Please try again.");
          return;
        }

        // Remember this token so we don't re-process it.
        markTokenProcessed(token);
        // The one-time-token plugin does not emit Better Auth's normal session
        // signal, so refresh its built-in reactive store explicitly.
        await refetchSession();

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
          push("/dashboard");
        }
      } catch (error) {
        console.error("[DeepLinkHandler] Error processing deep link:", error);
        toast.error("Something went wrong during sign-in.");
      } finally {
        if (token) {
          inFlightTokens.delete(token);
        }
      }
    },
    [push, queryClient, refetchSession]
  );

  useMountEffect(() => {
    let disposed = false;
    let cleanupFn: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrent, onOpenUrl } = await import(
          "@tauri-apps/plugin-deep-link"
        );

        // Check if the app was launched via a deep link.
        const startUrls = await getCurrent();
        if (startUrls && startUrls.length > 0) {
          await Promise.all(startUrls.map(handleDeepLinkUrl));
        }

        // Listen for deep link events while the app is running.
        const unlisten = await onOpenUrl((urls) => {
          Promise.all(urls.map(handleDeepLinkUrl)).catch((error) => {
            console.warn("[DeepLinkHandler] Failed to process URLs:", error);
          });
        });

        if (disposed) {
          unlisten();
          return;
        }
        cleanupFn = unlisten;
      } catch (error) {
        // Deep link plugin may not be available in dev mode.
        console.warn("[DeepLinkHandler] Plugin not available:", error);
      }
    };

    setup();

    return () => {
      disposed = true;
      cleanupFn?.();
    };
  });

  return null;
}
