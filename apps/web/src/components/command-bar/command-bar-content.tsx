"use client";

import { useCallback, useState } from "react";
import { Command, CommandInput, CommandList } from "@/components/ui/command";
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

interface CommandBarContentProps {
  className?: string;
  onRequestClose?: () => void;
  selectionMode?: "desktop-popup" | "local";
  size?: "sm" | "md" | "lg";
}

function activateCommandItem(
  event: React.KeyboardEvent,
  fallbackToFirst: boolean
) {
  const selected =
    document.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]') ??
    (fallbackToFirst
      ? document.querySelector<HTMLElement>("[cmdk-item]")
      : null);
  if (!selected) {
    return;
  }
  event.preventDefault();
  selected.click();
}

/**
 * Reusable command bar body shared by the dashboard dialog and the
 * desktop popup window. Renders the Command surface with input, list,
 * and view-switching logic.
 */
export function CommandBarContent({
  onRequestClose,
  size = "lg",
  selectionMode = "local",
  className,
}: CommandBarContentProps) {
  const [view, setView] = useState<CommandBarView>("root");
  const [search, setSearch] = useState("");

  // Handle keyboard events at the Command level.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view !== "root") {
          e.preventDefault();
          setView("root");
          setSearch("");
          return;
        }

        if (onRequestClose) {
          e.preventDefault();
          onRequestClose();
        }
        return;
      }

      if (view === "root") {
        return;
      }

      if (e.key === "Enter" && selectionMode === "desktop-popup") {
        activateCommandItem(e, true);
        return;
      }

      // Tab auto-completes the currently highlighted item (e.g., tag selection).
      if (e.key === "Tab" && view === "create-task") {
        activateCommandItem(e, false);
      }
    },
    [onRequestClose, selectionMode, view]
  );

  // Navigate to a specific view.
  const navigateToView = useCallback((targetView: CommandBarView) => {
    setView(targetView);
    setSearch("");
  }, []);
  const handleCreated = useCallback(() => setSearch(""), []);

  // Derive placeholder text directly from the active command-bar mode.
  let placeholder = "Type a command or search...";
  if (view === "search-tasks") {
    placeholder = "Search tasks...";
  } else if (view === "create-task") {
    placeholder = "Task title =duration >due ~start...";
  }

  return (
    <Command
      className={className}
      onKeyDown={handleKeyDown}
      shouldFilter={view === "root"}
      size={size}
    >
      <CommandInput
        autoFocus
        onValueChange={setSearch}
        placeholder={placeholder}
        value={search}
      />
      <CommandList>
        {view === "root" && <CommandBarRoot onNavigate={navigateToView} />}
        {view === "search-tasks" && (
          <CommandBarSearchTasks
            search={search}
            selectionMode={selectionMode}
          />
        )}
        {view === "create-task" && (
          <CommandBarCreateTask
            onCreated={handleCreated}
            onUpdateSearch={setSearch}
            search={search}
          />
        )}
      </CommandList>
    </Command>
  );
}
