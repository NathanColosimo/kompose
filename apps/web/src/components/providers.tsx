"use client";

import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "next-themes";
import { isDesktopRuntime } from "@/lib/desktop";

function VercelAnalytics() {
  if (isDesktopRuntime()) {
    return null;
  }
  return <Analytics />;
}

/**
 * What every page needs. The signed-in app's providers live in
 * app/(app)/layout.tsx so public pages don't download them.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      {children}
      <VercelAnalytics />
    </ThemeProvider>
  );
}
