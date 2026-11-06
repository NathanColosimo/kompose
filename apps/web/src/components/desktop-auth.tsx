"use client";

import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, getElectronAuthQuery } from "@/lib/auth-client";
import { isDesktopRuntime } from "@/lib/desktop";
import {
  createDesktopAuthHandoff,
  redirectElectronAuth,
} from "@/lib/desktop-auth-handoff";
import { Button } from "./ui/button";

/** Owns browser handoff; Electron main stores its session and reloads itself. */
export function DesktopAuth({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  const [handoff] = useState(() =>
    createDesktopAuthHandoff({
      getAuthorizationCode: () => authClient.electron.getAuthorizationCode(),
      redirect: redirectElectronAuth,
      transferUser: async (query, signal) => {
        const { error } = await authClient.electron.transferUser({
          fetchOptions: { query, signal },
        });
        if (error) {
          throw new Error(
            error.message ||
              "Could not authorize desktop sign-in. Please try again."
          );
        }
      },
    })
  );
  const state = useSyncExternalStore(
    handoff.subscribe,
    handoff.getSnapshot,
    handoff.getServerSnapshot
  );

  useMountEffect(() => {
    if (isDesktopRuntime()) {
      return window.onAuthError((error) => toast.error(error.message));
    }
  });

  useEffect(() => {
    if (isDesktopRuntime()) {
      return;
    }
    return handoff.start({
      query: pathname === "/login" ? getElectronAuthQuery() : null,
      signedIn,
    });
  }, [handoff, pathname, signedIn]);

  if (state.status === "idle") {
    return children;
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-8 text-center">
      <div className="space-y-4">
        {state.status === "error" ? (
          <>
            <p role="alert">{state.message}</p>
            <Button onClick={handoff.retry} type="button">
              Try again
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground" role="status">
            {state.status === "complete"
              ? "Continue in Kompose. You can close this browser tab."
              : "Opening your workspace…"}
          </p>
        )}
      </div>
    </main>
  );
}
