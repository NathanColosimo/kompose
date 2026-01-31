"use client";

import { useAtom } from "jotai";
import { useCallback, useState } from "react";
import { commandBarOpenAtom } from "@/atoms/command-bar";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import { CommandBarRoot } from "./command-bar-root";
import { CommandBarSearchTasks } from "./command-bar-search-tasks";

/**
 * Available views in the command bar.
 * - root: Main actions list
 * - search-tasks: Task search sub-view
 */
type CommandBarView = "root" | "search-tasks";

/**
 * CommandBar - Unified command palette (cmd+k) for quick actions.
 *
 * Features:
 * - Arrow key navigation (handled by cmdk)
 * - Search filtering (handled by cmdk)
 * - Nested views: selecting an action can transition to a sub-view
 * - Escape: navigates back to root, then closes
 */
export function CommandBar() {
  const [open, setOpen] = useAtom(commandBarOpenAtom);
  const [view, setView] = useState<CommandBarView>("root");
  const [search, setSearch] = useState("");

  // Reset state when dialog closes
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        // Reset to root view and clear search when closing
        setView("root");
        setSearch("");
      }
    },
    [setOpen]
  );

  // Handle escape key: go back to root if in sub-view, otherwise close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view !== "root") {
          e.preventDefault();
          setView("root");
          setSearch("");
        }
        // If in root view, let the dialog handle closing
      }
    },
    [view]
  );

  // Navigate to a specific view
  const navigateToView = useCallback((targetView: CommandBarView) => {
    setView(targetView);
    setSearch("");
  }, []);

  // Get placeholder text based on current view
  const getPlaceholder = () => {
    switch (view) {
      case "search-tasks":
        return "Search tasks...";
      default:
        return "Type a command or search...";
    }
  };

  return (
    <CommandDialog onOpenChange={handleOpenChange} open={open}>
      <Command onKeyDown={handleKeyDown} shouldFilter={view === "root"}>
        <CommandInput
          onValueChange={setSearch}
          placeholder={getPlaceholder()}
          value={search}
        />
        <CommandList>
          {view === "root" && <CommandBarRoot onNavigate={navigateToView} />}
          {view === "search-tasks" && <CommandBarSearchTasks search={search} />}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
