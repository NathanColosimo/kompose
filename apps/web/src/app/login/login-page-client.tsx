"use client";

import { env } from "@kompose/env";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SessionFeedback } from "@/components/auth/session-feedback";
import SignInForm from "@/components/auth/sign-in-form";
import SignUpForm from "@/components/auth/sign-up-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, getElectronAuthQuery } from "@/lib/auth-client";

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
    <p className="p-8 text-center text-muted-foreground">
      Opening your workspace…
    </p>
  );
}

export default function LoginPageClient() {
  const {
    data: session,
    error,
    isPending,
    isRefetching,
    refetch,
  } = authClient.useSession();
  const privacyHref =
    env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production"
      ? `${env.NEXT_PUBLIC_WEB_URL}/privacy`
      : "/privacy";
  const termsHref =
    env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production"
      ? `${env.NEXT_PUBLIC_WEB_URL}/terms`
      : "/terms";
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

  if (session?.user) {
    return <DashboardRedirect />;
  }

  return (
    <main className="bg-background text-foreground">
      {/* Keep login/signup screens draggable in the desktop window. */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-8 select-none"
        data-desktop-drag-region
      />
      <div className="grid min-h-svh gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-border/50 bg-linear-to-br from-primary/15 via-background to-background p-10 text-left lg:flex">
          <div className="space-y-6">
            <Link className="text-muted-foreground text-sm" href="/">
              Back to kompose.dev
            </Link>
            <p className="text-muted-foreground text-sm uppercase tracking-[0.35em]">
              kompose
            </p>
            <h1 className="font-serif text-5xl leading-tight">
              Your calendar and tasks, orchestrated together.
            </h1>
            <p className="text-lg text-muted-foreground">
              Schedule backlog work by drag-and-drop and keep your connected
              calendars in sync.
            </p>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-border/40 bg-card/50 p-4">
              <p className="text-muted-foreground text-sm uppercase tracking-[0.2em]">
                why teams switch
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                <li>Shared task + calendar source of truth</li>
                <li>Recurring tasks and flexible scheduling</li>
                <li>Desktop + mobile apps</li>
              </ul>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-muted-foreground text-xs">
              <a
                className="underline-offset-4 hover:underline"
                href={privacyHref}
              >
                Privacy Policy
              </a>
              <a
                className="underline-offset-4 hover:underline"
                href={termsHref}
              >
                Terms of Service
              </a>
            </div>
          </div>
        </section>
        <section className="flex items-center justify-center px-6 pt-12 pb-20">
          <div className="w-full max-w-md">
            <Tabs className="space-y-6" defaultValue="sign-in">
              <TabsList className="w-full border border-border/60 bg-linear-to-r from-primary/15 via-secondary/15 to-accent/15 shadow-sm">
                <TabsTrigger
                  className="flex-1 text-foreground/70 data-[state=active]:bg-background/80 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-ring/30 dark:data-[state=active]:ring-ring/20"
                  value="sign-in"
                >
                  Sign in
                </TabsTrigger>
                <TabsTrigger
                  className="flex-1 text-foreground/70 data-[state=active]:bg-background/80 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-ring/30 dark:data-[state=active]:ring-ring/20"
                  value="sign-up"
                >
                  Sign up
                </TabsTrigger>
              </TabsList>
              <TabsContent value="sign-in">
                <SignInForm />
              </TabsContent>
              <TabsContent value="sign-up">
                <SignUpForm />
              </TabsContent>
            </Tabs>
          </div>
        </section>
      </div>
    </main>
  );
}
