"use client";

import { DESKTOP_COMMAND_BAR_MAX_HEIGHT } from "@kompose/desktop";
import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { focusManager } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { useCallback, useEffect, useState } from "react";
import { SessionFeedback } from "@/components/auth/session-feedback";
import { CommandBarContent } from "@/components/command-bar/command-bar-content";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import { desktopBridge, isDesktopRuntime } from "@/lib/desktop";
import { usePreloadTaskParser } from "@/lib/use-magic-task";

/**
 * Dedicated command bar page for the desktop popup window.
 * Renders only the command-bar surface for the popup window. The web dialog
 * wrapper is intentionally skipped here because the popup already owns its own
 * native window and should size directly to the command surface.
 */
export default function DesktopCommandBarClient() {
  useHydrateAtoms([[commandBarOpenAtom, true]]);
  usePreloadTaskParser();
  // Read after mount: rendering the surface during hydration would mismatch
  // the server HTML, and React's client re-render drops the preload's
  // data-desktop-runtime attribute that enables the drag styles.
  const [isDesktop, setIsDesktop] = useState(false);
  const [open, setOpen] = useAtom(commandBarOpenAtom);
  const {
    data: session,
    error: sessionError,
    isPending: isSessionPending,
    isRefetching,
    refetch: refetchSession,
  } = authClient.useSession();
  const handleRequestClose = useCallback(() => setOpen(false), [setOpen]);
  const handleShowMainWindow = useCallback(
    () => desktopBridge().showMainWindow(),
    []
  );
  let view: "content" | "feedback" | "signed-out" = "signed-out";
  // A failed refresh keeps the signed-in session; only show it without one.
  if (isSessionPending || (!session?.user && sessionError)) {
    view = "feedback";
  } else if (session?.user) {
    view = "content";
  }

  // Open the command bar when the window gains focus.
  useMountEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    setIsDesktop(true);

    const handleFocus = () => {
      focusManager.setFocused(true);
      setOpen(true);
    };
    const handleBlur = () => focusManager.setFocused(false);
    handleFocus();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      focusManager.setFocused(undefined);
    };
  });

  // Dismiss the command bar through the main process so the previous app is reactivated
  // before the window hides, avoiding a flicker of the main Kompose window.
  useEffect(() => {
    if (!isDesktopRuntime() || open) {
      return;
    }
    desktopBridge()
      .dismissCommandBar()
      .catch((error) => {
        console.warn("Failed to dismiss command bar window.", error);
      });
  }, [open]);

  // Loading/sign-in surfaces have no command input to handle Escape.
  useEffect(() => {
    if (!open || view === "content") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, view, setOpen]);

  // Size the native window to the surface whenever it mounts or its content changes.
  const surfaceRef = useCallback((surface: HTMLDivElement | null) => {
    if (!surface) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const rect = surface.getBoundingClientRect();
      const height = Math.min(
        DESKTOP_COMMAND_BAR_MAX_HEIGHT,
        Math.max(Math.ceil(rect.height), surface.scrollHeight)
      );
      if (rect.width <= 0 || height <= 0) {
        return;
      }
      desktopBridge()
        .resizeCommandBar(height)
        .catch((error) => {
          console.warn("Failed to resize command bar window.", error);
        });
    });
    // Observing reports the initial size, too.
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  if (!(isDesktop && open)) {
    return null;
  }

  return (
    <div
      className="inline-block"
      data-command-bar-surface
      ref={surfaceRef}
      style={{
        maxWidth: "100vw",
        width: "32rem",
      }}
    >
      {view === "content" ? (
        <CommandBarContent
          className="h-auto"
          onRequestClose={handleRequestClose}
          selectionMode="desktop-popup"
          size="lg"
        />
      ) : (
        <div className="rounded-xl border bg-popover p-4 text-popover-foreground text-sm">
          {view === "feedback" ? (
            <SessionFeedback
              error={Boolean(sessionError)}
              onRetry={refetchSession}
              retrying={isRefetching}
            />
          ) : (
            <>
              <p>Sign in to use quick actions.</p>
              <Button className="mt-3" onClick={handleShowMainWindow}>
                Open Kompose
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
