"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useAtom } from "jotai";
import dynamic from "next/dynamic";
import { useCallback } from "react";
import { CommandDialog } from "@/components/ui/command";

const LazyCommandBarContent = dynamic(
  () =>
    import("./command-bar-content").then((mod) => ({
      default: mod.CommandBarContent,
    })),
  { ssr: false }
);

/**
 * CommandBar - Unified command palette (cmd+k) for quick actions in the app.
 */
export function CommandBar() {
  const [open, setOpen] = useAtom(commandBarOpenAtom);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
    },
    [setOpen]
  );

  const handleRequestClose = useCallback(() => setOpen(false), [setOpen]);
  const handleEscapeKeyDown = useCallback((event: KeyboardEvent) => {
    // The content owns Escape: nested modes go back; the root closes.
    event.preventDefault();
  }, []);

  return (
    <CommandDialog
      onEscapeKeyDown={handleEscapeKeyDown}
      onOpenChange={handleOpenChange}
      open={open}
      size="lg"
    >
      {open ? (
        <LazyCommandBarContent onRequestClose={handleRequestClose} size="lg" />
      ) : null}
    </CommandDialog>
  );
}
