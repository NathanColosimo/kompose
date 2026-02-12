"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Marketing bullets used to keep the hero punchy without extra copy.
const highlights = [
  {
    title: "Calendar + tasks",
    body: "Plan deep work blocks, drag tasks into your day, and keep commitments realistic.",
  },
  {
    title: "AI assistant",
    body: "Reschedule work, draft plans, or ask for status with plain language instead of menus.",
  },
  {
    title: "All your tools",
    body: "Notion, Linear, and Google Calendar data live in one orchestration canvas.",
  },
  {
    title: "Local-first sync",
    body: "Tauri and Expo apps stay fast offline, then reconcile instantly when you're back online.",
  },
];

export default function Home() {
  return (
    <main className="bg-background text-foreground">
      {/* Provide a drag handle on desktop (Tauri) without affecting web behavior. */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-8 select-none"
        data-tauri-drag-region
      />
      <section className="container mx-auto flex min-h-[calc(100svh-4rem)] flex-col gap-12 px-6 py-20 lg:flex-row lg:items-center">
        <div className="space-y-8 text-center lg:text-left">
          <p className="font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
            compose every hour with intent
          </p>
          <div className="space-y-6">
            <h1 className="font-serif text-4xl leading-tight sm:text-5xl lg:text-6xl">
              One timeline for your calendar, tasks, and AI copilot.
            </h1>
            <p className="text-lg text-muted-foreground sm:text-xl">
              Kompose merges events, tasks, and natural-language automation so
              you can plan a week in minutes and stay focused when plans change.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Button asChild size="lg">
              <Link href="/login">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="#features">See how it works</Link>
            </Button>
          </div>
        </div>
        <div
          className="grid w-full gap-4 rounded-3xl border border-border/40 bg-card/40 p-6 shadow-xl lg:max-w-lg"
          id="features"
        >
          {highlights.map((highlight) => (
            <div
              className="rounded-2xl border border-border/50 bg-background/60 p-4 text-left"
              key={highlight.title}
            >
              <p className="font-semibold">{highlight.title}</p>
              <p className="text-muted-foreground text-sm">{highlight.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
