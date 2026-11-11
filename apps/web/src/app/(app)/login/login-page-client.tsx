"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SessionFeedback } from "@/components/auth/session-feedback";
import { SocialAccountButtons } from "@/components/auth/social-account-buttons";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, getElectronAuthQuery } from "@/lib/auth-client";
import { isDesktopRuntime } from "@/lib/desktop";

function DashboardRedirect() {
  const { replace } = useRouter();
  const handoff = useMutation({
    mutationFn: async () => {
      const query = getElectronAuthQuery();
      if (!query) {
        replace("/dashboard");
        return;
      }
      const { error } = await authClient.electron.transferUser({
        fetchOptions: { query },
      });
      if (error) {
        throw new Error(
          error.message || "Desktop sign-in failed. Please try again."
        );
      }
      authClient.ensureElectronRedirect();
    },
  });

  useMountEffect(() => {
    handoff.mutate();
  });

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center text-sm">
      {handoff.isError ? (
        <p role="alert">{handoff.error.message}</p>
      ) : (
        <p className="text-muted-foreground" role="status">
          Opening your workspace…
        </p>
      )}
      <Button
        disabled={handoff.isPending}
        onClick={() => handoff.mutate()}
        type="button"
      >
        Try again
      </Button>
    </main>
  );
}

/**
 * The desktop app signs in through the system browser. Without a provider,
 * Better Auth opens this login page there, so a browser that is already signed
 * in hands its session over (DashboardRedirect) instead of repeating OAuth.
 */
function requestBrowserSignIn() {
  window.requestAuth();
}

function DesktopSignIn() {
  return (
    <>
      <p className="text-muted-foreground text-sm">
        Continue in your browser. If you're already signed in there, you'll come
        straight back.
      </p>
      <Button
        className="h-10 w-full text-sm"
        onClick={requestBrowserSignIn}
        type="button"
      >
        Continue in browser
      </Button>
    </>
  );
}

/** True while an MCP client's OAuth authorization is waiting on sign-in. */
function hasSignedOAuthQuery() {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("sig")
  );
}

export default function LoginPageClient() {
  const [isDesktop, setIsDesktop] = useState(false);
  // The OAuth provider only sees sessions stored in Postgres, so sessions from
  // before that are sent here; signing in again continues the authorization.
  const [isOAuthSignIn] = useState(hasSignedOAuthQuery);
  useMountEffect(() => {
    setIsDesktop(isDesktopRuntime());
  });
  const {
    data: session,
    error,
    isPending,
    isRefetching,
    refetch,
  } = authClient.useSession();
  if (isPending || (!session?.user && error)) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6 text-center text-sm">
        <SessionFeedback
          error={Boolean(error)}
          onRetry={refetch}
          retrying={isRefetching}
        />
      </main>
    );
  }

  if (session?.user && !isOAuthSignIn) {
    return <DashboardRedirect />;
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header data-desktop-drag-region>
        <div
          className="mx-auto flex h-16 max-w-6xl items-center px-6"
          data-window-controls-inset
        >
          <Link className="font-medium font-serif text-lg" href="/">
            Kompose
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-[20svh]">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="font-serif text-3xl">Sign in to Kompose</h1>
            {isDesktop ? null : (
              <p className="text-muted-foreground text-sm">
                New here? Continuing creates your account.
              </p>
            )}
          </div>
          {isDesktop ? <DesktopSignIn /> : <SocialAccountButtons />}
          <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
            By continuing you agree to the{" "}
            <a className="underline underline-offset-4" href="/terms">
              Terms of Service
            </a>{" "}
            and{" "}
            <a className="underline underline-offset-4" href="/privacy">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
