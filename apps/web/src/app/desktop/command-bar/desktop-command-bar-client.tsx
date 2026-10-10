"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { focusManager } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { CommandBarContent } from "@/components/command-bar/command-bar-content";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import { desktopBridge, isDesktopRuntime } from "@/lib/desktop";

const COMMAND_BAR_MAX_HEIGHT = 520;

/**
 * Dedicated command bar page for the desktop popup window.
 * Renders only the command-bar surface for the popup window. The web dialog
 * wrapper is intentionally skipped here because the popup already owns its own
 * native window and should size directly to the command surface.
 */
export default function DesktopCommandBarClient() {
  const [open, setOpen] = useAtom(commandBarOpenAtom);
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const handleRequestClose = useCallback(() => setOpen(false), [setOpen]);

  // Open the command bar when the window gains focus.
  useMountEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }

    focusManager.setFocused(true);
    setOpen(true);
    let unlisten: (() => void) | null = null;

    unlisten = desktopBridge().onWindowFocus((focused) => {
      focusManager.setFocused(focused);
      if (focused) {
        setOpen(true);
      }
    });
    return () => {
      unlisten?.();
      focusManager.setFocused(undefined);
    };
  });

  // Dismiss the command bar through the main process so the previous app is reactivated
  // before the window hides, avoiding a flicker of the main Kompose window.
  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    if (open) {
      return;
    }

    let cancelled = false;
    desktopBridge()
      .dismissCommandBar()
      .catch((error) => {
        if (!cancelled) {
          console.warn("Failed to dismiss command bar window.", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Auto-size the desktop window to exactly fit the dialog content.
  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    if (!open) {
      return;
    }

    let disposed = false;
    const resizeWindowToContent = async (surface: HTMLElement) => {
      if (disposed) {
        return;
      }
      const rect = surface.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.min(
        COMMAND_BAR_MAX_HEIGHT,
        Math.max(Math.ceil(rect.height), surface.scrollHeight)
      );
      if (width <= 0 || height <= 0) {
        return;
      }
      await desktopBridge().resizeCommandBar(height);
    };

    const el = document.querySelector<HTMLElement>(
      "[data-command-bar-surface]"
    );
    if (!el) {
      return;
    }

    const observer = new ResizeObserver(() => {
      resizeWindowToContent(el).catch((error) => {
        console.warn("Failed to resize command bar window.", error);
      });
    });
    observer.observe(el);

    resizeWindowToContent(el).catch((error) => {
      console.warn("Failed to resize command bar window.", error);
    });

    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [open]);

  if (!isDesktopRuntime()) {
    return null;
  }

  if (!open || isSessionPending || !session?.user) {
    return null;
  }

  return (
    <div
      className="inline-block"
      data-command-bar-surface
      style={{
        maxWidth: "100vw",
        width: "32rem",
      }}
    >
      <CommandBarContent
        className="h-auto"
        onRequestClose={handleRequestClose}
        selectionMode="desktop-popup"
        size="lg"
      />
    </div>
  );
}
