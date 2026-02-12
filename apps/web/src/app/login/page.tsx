"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SignInForm from "@/components/auth/sign-in-form";
import SignUpForm from "@/components/auth/sign-up-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const finishCheck = (user: unknown | null) => {
      if (cancelled) {
        return;
      }
      const hasSession = Boolean(user);
      setHasActiveSession(hasSession);
      setSessionChecked(true);
      if (hasSession) {
        router.replace("/dashboard");
      }
    };

    authClient
      .getSession({ query: { disableCookieCache: true } })
      .then((result) => finishCheck(result?.data?.user ?? null))
      .catch(() => finishCheck(null));

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!sessionChecked) {
    return null;
  }

  if (hasActiveSession) {
    return null;
  }

  return (
    <main className="bg-background text-foreground">
      {/* Keep login/signup screens draggable in the Tauri desktop window. */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-8 select-none"
        data-tauri-drag-region
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
              Schedule backlog work by drag-and-drop, keep integrations synced,
              and ask the AI assistant to reshuffle.
            </p>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-border/40 bg-card/50 p-4">
              <p className="text-muted-foreground text-sm uppercase tracking-[0.2em]">
                why teams switch
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                <li>Shared task + calendar source of truth</li>
                <li>Natural-language automations with guardrails</li>
                <li>Local-first desktop + mobile apps</li>
              </ul>
            </div>
            <p className="text-muted-foreground text-xs">
              Need help? Email{" "}
              <a className="underline" href="--">
                --
              </a>
            </p>
          </div>
        </section>
        <section className="flex items-center justify-center px-6 pt-12 pb-20">
          <div className="w-full max-w-md">
            <Tabs className="space-y-6" defaultValue="sign-in">
              <TabsList className="w-full border border-border/60 bg-linear-to-r from-primary/15 via-sky-500/15 to-indigo-500/15 shadow-sm">
                <TabsTrigger
                  className="flex-1 text-foreground/70 data-[state=active]:bg-background/80 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-sky-500/30 dark:data-[state=active]:ring-sky-400/20"
                  value="sign-in"
                >
                  Sign in
                </TabsTrigger>
                <TabsTrigger
                  className="flex-1 text-foreground/70 data-[state=active]:bg-background/80 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-sky-500/30 dark:data-[state=active]:ring-sky-400/20"
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
