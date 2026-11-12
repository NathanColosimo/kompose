"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

const CLOSE_AFTER_MS = 10_000;

/**
 * Render once sign-in has been handed to the desktop app. When this tab loses
 * focus, which is when the app opens on top of the browser, it covers the page
 * with a countdown and then closes the tab.
 */
export function DesktopHandoff({ onStay }: { onStay: () => void }) {
  const [opened, setOpened] = useState(false);

  useMountEffect(() => {
    const onBlur = () => setOpened(true);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  });

  if (!opened) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
      <CloseCountdown onStay={onStay} />
    </div>
  );
}

/**
 * Browsers only let a page close a tab it has kept to one history entry, so
 * after the countdown the page asks the user to close it.
 */
function CloseCountdown({ onStay }: { onStay: () => void }) {
  const [closeAt] = useState(() => Date.now() + CLOSE_AFTER_MS);
  const [now, setNow] = useState(Date.now);

  useMountEffect(() => {
    const interval = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= closeAt) {
        clearInterval(interval);
        window.close();
      }
    }, 1000);
    return () => clearInterval(interval);
  });

  const secondsLeft = Math.max(0, Math.ceil((closeAt - now) / 1000));
  return (
    <div className="flex max-w-sm flex-col items-center gap-4 text-center">
      <h1 className="font-serif text-2xl">Kompose is open</h1>
      <p className="text-muted-foreground text-sm" role="status">
        {secondsLeft > 0
          ? `You can carry on in the desktop app. This tab will close in ${secondsLeft} ${secondsLeft === 1 ? "second" : "seconds"}.`
          : "You can carry on in the desktop app and close this tab."}
      </p>
      <Button onClick={onStay} type="button" variant="outline">
        Stay in the browser
      </Button>
    </div>
  );
}
