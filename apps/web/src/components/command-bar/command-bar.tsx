"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useAtom } from "jotai";
import { useCallback, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import { CommandBarCreateTask } from "./command-bar-create-task";
import { CommandBarRoot } from "./command-bar-root";
import { CommandBarSearchTasks } from "./command-bar-search-tasks";

/**
 * Available views in the command bar.
 * - root: Main actions list
 * - search-tasks: Task search sub-view
 * - create-task: Create task with NLP input
 */
type CommandBarView = "root" | "search-tasks" | "create-task";

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

  // Ref to store the create task submit function
  const createTaskSubmitRef = useRef<(() => void) | null>(null);

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

  // Handle keyboard events at the Command level
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && view !== "root") {
        e.preventDefault();
        setView("root");
        setSearch("");
        // If in root view, let the dialog handle closing
      }

      // Handle Enter in create-task view
      if (e.key === "Enter" && view === "create-task") {
        e.preventDefault();
        createTaskSubmitRef.current?.();
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
      case "create-task":
        return "Task title =duration >due ~start...";
      default:
        return "Type a command or search...";
    }
  };

  return (
    <CommandDialog onOpenChange={handleOpenChange} open={open} size="lg">
      <Command
        onKeyDown={handleKeyDown}
        shouldFilter={view === "root"}
        size="lg"
      >
        <CommandInput
          onValueChange={setSearch}
          placeholder={getPlaceholder()}
          value={search}
        />
        <CommandList>
          {view === "root" && <CommandBarRoot onNavigate={navigateToView} />}
          {view === "search-tasks" && <CommandBarSearchTasks search={search} />}
          {view === "create-task" && (
            <CommandBarCreateTask
              onCreated={() => setSearch("")}
              onRegisterSubmit={(fn) => {
                createTaskSubmitRef.current = fn;
              }}
              onUpdateSearch={setSearch}
              search={search}
            />
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
