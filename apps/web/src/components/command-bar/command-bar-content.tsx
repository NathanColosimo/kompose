"use client";

import { useCallback, useRef, useState } from "react";
import { Command, CommandInput, CommandList } from "@/components/ui/command";
import { CommandBarCreateTask } from "./command-bar-create-task";
import { CommandBarRoot } from "./command-bar-root";
import { CommandBarSearchTasks } from "./command-bar-search-tasks";

type CommandBarView = "root" | "search-tasks" | "create-task";

interface CommandBarContentProps {
  className?: string;
  onRequestClose: () => void;
  selectionMode?: "desktop-popup" | "local";
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

/** Shared by the dashboard dialog and desktop popup window. */
export function CommandBarContent({
  onRequestClose,
  selectionMode = "local",
  className,
}: CommandBarContentProps) {
  const [view, setView] = useState<CommandBarView>("root");
  const [search, setSearch] = useState("");

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view !== "root") {
          e.preventDefault();
          setView("root");
          setSearch("");
          return;
        }

        e.preventDefault();
        onRequestClose();
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

  const inputRef = useRef<HTMLInputElement>(null);
  const navigateToView = useCallback((targetView: CommandBarView) => {
    setView(targetView);
    setSearch("");
    // Choosing a view with the mouse moves focus to the item; typing then
    // has to land in the search field, not on the page's shortcuts.
    inputRef.current?.focus();
  }, []);
  const handleCreated = useCallback(() => setSearch(""), []);

  let placeholder = "Type a command…";
  if (view === "search-tasks") {
    placeholder = "Search tasks…";
  } else if (view === "create-task") {
    placeholder = "Task title =duration >due ~start…";
  }

  return (
    <Command
      className={className}
      onKeyDown={handleKeyDown}
      shouldFilter={view === "root"}
      size="lg"
    >
      <CommandInput
        autoFocus
        onValueChange={setSearch}
        placeholder={placeholder}
        ref={inputRef}
        value={search}
      />
      <CommandList>
        {view === "root" && (
          <CommandBarRoot
            canCreateEvent={selectionMode === "local"}
            onNavigate={navigateToView}
          />
        )}
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
