"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { focusManager } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { CommandBarContent } from "@/components/command-bar/command-bar-content";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import { isTauriRuntime } from "@/lib/tauri-desktop";

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
    if (!isTauriRuntime()) {
      return;
    }

    focusManager.setFocused(true);
    setOpen(true);
    let disposed = false;
    let unlisten: (() => void) | null = null;

    getCurrentWindow()
      .onFocusChanged((event) => {
        focusManager.setFocused(event.payload);
        if (event.payload) {
          setOpen(true);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((error) => {
        console.warn("Failed to register command bar focus listener.", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
      focusManager.setFocused(undefined);
    };
  });

  // Dismiss the command bar via Rust so the previous app is reactivated
  // before the window hides, avoiding a flicker of the main Kompose window.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    if (open) {
      return;
    }

    let cancelled = false;
    invoke("dismiss_command_bar").catch((error) => {
      if (!cancelled) {
        console.warn("Failed to dismiss command bar window.", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Auto-size the Tauri window to exactly fit the dialog content.
  useEffect(() => {
    if (!isTauriRuntime()) {
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
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(width, height));
      await win.center();
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

  if (!isTauriRuntime()) {
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
