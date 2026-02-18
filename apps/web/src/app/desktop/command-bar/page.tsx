"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { CommandBarContent } from "@/components/command-bar/command-bar";
import { CommandDialog } from "@/components/ui/command";
import { isTauriRuntime } from "@/lib/tauri-desktop";

const COMMAND_BAR_MAX_HEIGHT = 520;

/**
 * Dedicated command bar page for the desktop popup window.
 * Renders the same CommandDialog used on web so behavior is identical.
 * The dialog overlay is transparent and the DialogContent is pinned to
 * top-left so a ResizeObserver can snap the Tauri window to exactly
 * match the content dimensions.
 */
export default function DesktopCommandBarPage() {
  const [open, setOpen] = useAtom(commandBarOpenAtom);

  // Open the command bar when the window gains focus.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    setOpen(true);
    let unlisten: (() => void) | null = null;

    getCurrentWindow()
      .onFocusChanged((event) => {
        if (event.payload) {
          setOpen(true);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((error) => {
        console.warn("Failed to register command bar focus listener.", error);
      });

    return () => {
      unlisten?.();
    };
  }, [setOpen]);

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
    let cleanupRef: (() => void) | null = null;

    const resizeWindowToContent = async (el: HTMLElement) => {
      if (disposed) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.min(
        COMMAND_BAR_MAX_HEIGHT,
        Math.max(Math.ceil(rect.height), el.scrollHeight)
      );
      if (width <= 0 || height <= 0) {
        return;
      }
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(width, height));
      await win.center();
    };

    const startObserving = () => {
      const el = document.querySelector<HTMLElement>(
        '[data-slot="dialog-content"]'
      );
      if (!el) {
        const frameId = requestAnimationFrame(startObserving);
        cleanupRef = () => cancelAnimationFrame(frameId);
        return;
      }

      const observer = new ResizeObserver(() => {
        resizeWindowToContent(el).catch((error) => {
          console.warn("Failed to resize command bar window.", error);
        });
      });
      observer.observe(el);
      cleanupRef = () => observer.disconnect();

      resizeWindowToContent(el).catch((error) => {
        console.warn("Failed to resize command bar window.", error);
      });
    };

    startObserving();

    return () => {
      disposed = true;
      cleanupRef?.();
    };
  }, [open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
    },
    [setOpen]
  );

  if (!isTauriRuntime()) {
    return null;
  }

  return (
    <CommandDialog
      className="top-0! left-0! w-full! max-w-none! translate-x-0! translate-y-0! rounded-none!"
      onOpenChange={handleOpenChange}
      open={open}
      overlayClassName="bg-transparent backdrop-blur-none"
      size="lg"
    >
      <CommandBarContent className="h-auto" isOpen={open} size="lg" />
    </CommandDialog>
  );
}
