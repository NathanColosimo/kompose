import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

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
    <>
      <SiteHeader />
      <main>
        <article className="mx-auto max-w-3xl px-6 pt-10 pb-20 sm:pt-16">
          <header className="flex flex-col gap-3 border-b pb-8">
            <h1 className="font-serif text-4xl sm:text-5xl">{title}</h1>
            <p className="max-w-2xl text-lg text-muted-foreground">{summary}</p>
            <p className="text-muted-foreground text-sm">
              {/* An ISO date: read it as a calendar day, not UTC midnight. */}
              Last updated{" "}
              {new Date(`${updatedAt}T00:00:00`).toLocaleDateString("en-US", {
                dateStyle: "long",
              })}
            </p>
          </header>

          <div className="space-y-8 pt-8 text-base leading-7">{children}</div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
