"use client";

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

  useMountEffect(() => {
    const query = getElectronAuthQuery();
    if (query) {
      authClient.electron
        .transferUser({ fetchOptions: { query } })
        .then(({ error }) => {
          if (error) {
            console.error("Electron authorization failed", error.message);
          } else {
            authClient.ensureElectronRedirect();
          }
        });
    } else {
      replace("/dashboard");
    }
  });

  return (
    <main className="flex min-h-svh items-center justify-center p-6 text-muted-foreground text-sm">
      <p role="status">Opening your workspace…</p>
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
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      {/* Keep the login screen draggable in the desktop window. */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-8 select-none"
        data-desktop-drag-region
      />
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-6">
        <Link className="font-medium font-serif text-lg" href="/">
          Kompose
        </Link>
      </header>
      <section className="flex flex-1 items-center justify-center px-6 pb-24">
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
          <p className="text-muted-foreground text-xs leading-relaxed">
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
      </section>
    </main>
  );
}
