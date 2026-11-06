"use client";

import { useCallback, useReducer, useState } from "react";
import { Command, CommandInput, CommandList } from "@/components/ui/command";
import { CommandBarCreateTask } from "./command-bar-create-task";
import { commandBarInputReducer } from "./command-bar-input";
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
  const [input, dispatchInput] = useReducer(commandBarInputReducer, {
    revision: 0,
    text: "",
  });
  const search = input.text;
  const setSearch = useCallback((text: string) => {
    dispatchInput({ text, type: "change" });
  }, []);

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
    [onRequestClose, selectionMode, setSearch, view]
  );

  const navigateToView = useCallback(
    (targetView: CommandBarView) => {
      setView(targetView);
      setSearch("");
    },
    [setSearch]
  );
  const handleCreated = useCallback((revision: number) => {
    dispatchInput({ revision, type: "created" });
  }, []);

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
      size="lg"
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
            input={input}
            onCreated={handleCreated}
            onUpdateSearch={setSearch}
          />
        )}
      </CommandList>
    </Command>
  );
}
