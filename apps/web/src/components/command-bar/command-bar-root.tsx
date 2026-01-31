"use client";

import { ListTodoIcon, PlusCircleIcon } from "lucide-react";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

type CommandBarView = "root" | "search-tasks" | "create-task";

interface CommandBarRootProps {
  onNavigate: (view: CommandBarView) => void;
}

type Action = {
  id: string;
  label: string;
  icon: React.ElementType;
  view: Exclude<CommandBarView, "root">;
};

/**
 * Available actions in the command bar root view.
 * Each action can either navigate to a sub-view or execute directly.
 */
const actions: Action[] = [
  {
    id: "search-tasks",
    label: "Search Tasks",
    icon: ListTodoIcon,
    view: "search-tasks",
  },
  {
    id: "create-task",
    label: "Create Task",
    icon: PlusCircleIcon,
    view: "create-task",
  },
];

/**
 * CommandBarRoot - The main actions list shown when the command bar opens.
 *
 * Lists available actions that users can navigate with arrow keys and select with Enter.
 * Selecting an action with a `view` property navigates to that sub-view.
 */
export function CommandBarRoot({ onNavigate }: CommandBarRootProps) {
  const handleSelect = (action: Action) => {
    onNavigate(action.view);
  };

  return (
    <>
      <CommandEmpty>No commands found.</CommandEmpty>
      <CommandGroup heading="Actions">
        {actions.map((action) => (
          <CommandItem
            key={action.id}
            onSelect={() => handleSelect(action)}
            value={action.label}
          >
            <action.icon className="text-muted-foreground" />
            <span>{action.label}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
