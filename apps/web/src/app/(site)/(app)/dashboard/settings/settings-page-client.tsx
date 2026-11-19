"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { isDesktopRuntime } from "@/lib/desktop";
import { ConnectedAgentsSettings } from "./connected-agents-settings";
import { DesktopShortcutSettings } from "./desktop-shortcut-settings";
import { PluginConnectionsSettings } from "./plugin-connections-settings";

export default function SettingsPageClient() {
  const [isDesktop, setIsDesktop] = useState(false);

  useMountEffect(() => {
    setIsDesktop(isDesktopRuntime());
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <Button
          asChild
          className="text-muted-foreground"
          size="icon-lg"
          variant="ghost"
        >
          <Link aria-label="Back to calendar" href="/dashboard">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-base font-medium">Settings</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-8">
          {isDesktop ? (
            <p className="bg-card text-muted-foreground rounded-lg border px-4 py-3 text-sm">
              Accounts link in your browser. Sign in there with this Kompose
              account, then come back here.
            </p>
          ) : null}

          <PluginConnectionsSettings isDesktop={isDesktop} />

          <ConnectedAgentsSettings />

          {isDesktop ? <DesktopShortcutSettings /> : null}
        </div>
      </div>
    </div>
  );
}
