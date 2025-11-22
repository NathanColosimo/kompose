"use client";

import Link from "next/link";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginPage() {
  return (
    <main className="bg-background text-foreground">
      <div className="grid min-h-svh gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-border/50 bg-linear-to-br from-primary/15 via-background to-background p-10 text-left lg:flex">
          <div className="space-y-6">
            <Link className="text-muted-foreground text-sm" href="/">
              Back to kompose.com
            </Link>
            <p className="text-muted-foreground text-sm uppercase tracking-[0.35em]">
              kompose
            </p>
            <h1 className="font-serif text-5xl leading-tight">
              Your entire work week, orchestrated in one calm timeline.
            </h1>
            <p className="text-lg text-muted-foreground">
              Drag backlog tasks onto your calendar, let AI negotiate changes,
              and keep every integration in sync. Kompose turns chaotic juggling
              into deliberate planning.
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
              <a className="underline" href="mailto:hello@kompose.com">
                hello@kompose.com
              </a>
            </p>
          </div>
        </section>
        <section className="flex items-center justify-center px-6 pt-12 pb-20">
          <div className="w-full max-w-md space-y-10">
            <SignInForm />
            <div className="border-border/40 border-t" />
            <SignUpForm />
          </div>
        </section>
      </div>
    </main>
  );
}
