"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { isDesktopRuntime } from "@/lib/desktop";
import { ConnectedAgentsSettings } from "./connected-agents-settings";
import { DesktopShortcutSettings } from "./desktop-shortcut-settings";
import { PluginConnectionsSettings } from "./plugin-connections-settings";

export default function SettingsPageClient() {
  const [isDesktop, setIsDesktop] = useState(false);
  useMountEffect(() => setIsDesktop(isDesktopRuntime()));

  return (
    <>
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink asChild>
                <Link href="/dashboard">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-2xl">Settings</h1>
          <p className="text-muted-foreground">
            Connect calendars and health data, and manage AI agents.
            {isDesktop
              ? " Connect accounts in your browser using the same Kompose account, then return here."
              : null}
          </p>
        </div>

        <PluginConnectionsSettings />

        <ConnectedAgentsSettings />

        {isDesktop ? <DesktopShortcutSettings /> : null}
      </div>
    </>
  );
}
