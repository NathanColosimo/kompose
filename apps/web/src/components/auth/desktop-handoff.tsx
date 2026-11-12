"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const CLOSE_AFTER_SECONDS = 10;

/**
 * True once this tab loses focus after handing sign-in to the desktop app,
 * which is when the app opens on top of the browser.
 */
export function useDesktopAppOpened(handedOff: boolean) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!handedOff) {
      return;
    }
    const onBlur = () => setOpened(true);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [handedOff]);
  return opened;
}

/**
 * Tells the user the desktop app opened, then closes the tab. Browsers
 * only let a page close a tab it has kept to one history entry, so after the
 * countdown the page asks the user to close it.
 */
export function DesktopAppOpened({ onStay }: { onStay: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(CLOSE_AFTER_SECONDS);

  useEffect(() => {
    if (secondsLeft === 0) {
      window.close();
      return;
    }
    const timeout = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timeout);
  }, [secondsLeft]);

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
