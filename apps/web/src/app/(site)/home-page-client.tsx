"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { isDesktopRuntime } from "@/lib/desktop";
import { HomePreview } from "./home-preview";

// Only the desktop app checks the session here, so browsers never download
// the auth client on the landing page.
const DesktopHomeSessionGate = dynamic(
  () =>
    import("./desktop-home-session-gate").then(
      (mod) => mod.DesktopHomeSessionGate
    ),
  { ssr: false }
);

const highlights = [
  {
    body: "Drag tasks from your inbox onto the calendar. Kompose blocks the time, so your plan matches what you can actually do.",
    title: "Plan in the time you have",
  },
  {
    body: "Google Calendar events and WHOOP sleep and workouts sit next to your tasks, in one view.",
    title: "Everything in one view",
  },
  {
    body: "The desktop and mobile apps stay in sync, and AI assistants like Claude and ChatGPT can manage tasks for you.",
    title: "On every device",
  },
];

export default function HomePageClient() {
  const [showElectronSessionGate, setShowElectronSessionGate] = useState(false);

  useMountEffect(() => {
    setShowElectronSessionGate(isDesktopRuntime());
  });

  return showElectronSessionGate ? (
    <DesktopHomeSessionGate>
      <HomePageContent />
    </DesktopHomeSessionGate>
  ) : (
    <HomePageContent />
  );
}

function HomePageContent() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pt-12 pb-20 sm:pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-24">
          <div className="flex flex-col gap-6">
            <h1 className="text-balance font-serif text-4xl leading-[1.1] sm:text-5xl lg:text-6xl">
              One timeline for your calendar and tasks.
            </h1>
            <p className="max-w-lg text-pretty text-lg text-muted-foreground">
              Kompose puts your events and to-dos on the same calendar, so you
              can plan a week in minutes and adjust when plans change.
            </p>
            <Button asChild className="h-10 self-start px-4 text-sm">
              <Link href="/login">Get started</Link>
            </Button>
          </div>
          <HomePreview />
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-10 border-t pt-10 sm:grid-cols-3 sm:gap-8">
            {highlights.map((highlight) => (
              <div className="flex flex-col gap-2" key={highlight.title}>
                <h2 className="font-medium text-base">{highlight.title}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {highlight.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
