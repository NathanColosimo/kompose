"use client";

import { useCallback, useEffect, useState } from "react";
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

/**
 * Reusable command bar body shared by the dashboard dialog and the
 * desktop popup window. Renders the Command surface with input, list,
 * and view-switching logic.
 */
export function CommandBarContent({
  isOpen,
  onRequestClose,
  size = "lg",
  selectionMode = "local",
  className,
}: {
  isOpen: boolean;
  onRequestClose?: () => void;
  selectionMode?: "desktop-popup" | "local";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [view, setView] = useState<CommandBarView>("root");
  const [search, setSearch] = useState("");

  // Reset to root when the surrounding surface closes.
  useEffect(() => {
    if (isOpen) {
      return;
    }
    setView("root");
    setSearch("");
  }, [isOpen]);

  // Ensure the input is focused each time the surface opens.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusTimer = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-slot="command-input"]'
      );
      input?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusTimer);
    };
  }, [isOpen]);

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
      }

      // Enter in create-task view is handled by cmdk's native CommandItem
      // onSelect — no manual interception needed. This allows tag items and
      // the "Create Task" item to each respond to Enter correctly.

      // Tab auto-completes the currently highlighted item (e.g., tag selection).
      if (e.key === "Tab" && view === "create-task") {
        const selected = document.querySelector<HTMLElement>(
          '[cmdk-item][data-selected="true"]'
        );
        if (selected) {
          e.preventDefault();
          selected.click();
        }
      }
    },
    [onRequestClose, view]
  );

  // Navigate to a specific view.
  const navigateToView = useCallback((targetView: CommandBarView) => {
    setView(targetView);
    setSearch("");
  }, []);

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
            onCreated={() => setSearch("")}
            onUpdateSearch={setSearch}
            search={search}
          />
        )}
      </CommandList>
    </Command>
  );
}
