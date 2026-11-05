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

interface Action {
  icon: React.ElementType;
  id: string;
  label: string;
  view: Exclude<CommandBarView, "root">;
}

const actions: Action[] = [
  {
    icon: ListTodoIcon,
    id: "search-tasks",
    label: "Search Tasks",
    view: "search-tasks",
  },
  {
    icon: PlusCircleIcon,
    id: "create-task",
    label: "Create Task",
    view: "create-task",
  },
];

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
