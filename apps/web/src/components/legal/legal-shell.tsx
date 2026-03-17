import Link from "next/link";
import type { ReactNode } from "react";

interface LegalShellProps {
  readonly children: ReactNode;
  readonly summary: string;
  readonly title: string;
  readonly updatedAt: string;
}

export function LegalShell({
  title,
  summary,
  updatedAt,
  children,
}: LegalShellProps) {
  return (
    <main className="bg-background text-foreground">
      <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col px-6 py-12 sm:px-8">
        <div className="flex items-center justify-between gap-4 border-border/60 border-b pb-6">
          <Link
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            href="/"
          >
            Kompose
          </Link>
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <a className="underline-offset-4 hover:underline" href="/privacy">
              Privacy
            </a>
            <a className="underline-offset-4 hover:underline" href="/terms">
              Terms
            </a>
            <Link className="underline-offset-4 hover:underline" href="/login">
              Sign in
            </Link>
          </div>
        </div>

        <div className="max-w-3xl space-y-10 py-10">
          <header className="space-y-4">
            <p className="text-muted-foreground text-sm uppercase tracking-[0.25em]">
              Legal
            </p>
            <div className="space-y-3">
              <h1 className="font-serif text-4xl sm:text-5xl">{title}</h1>
              <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
                {summary}
              </p>
            </div>
            <p className="text-muted-foreground text-sm">
              Last updated: {updatedAt}
            </p>
          </header>

          <div className="space-y-8 text-sm leading-7 sm:text-base">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
