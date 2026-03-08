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

  return (
    <CommandDialog onOpenChange={handleOpenChange} open={open} size="lg">
      {open ? <LazyCommandBarContent isOpen={open} size="lg" /> : null}
    </CommandDialog>
  );
}
