"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useSetAtom } from "jotai";
import { CalendarPlusIcon, ListTodoIcon, PlusCircleIcon } from "lucide-react";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { createEventRequestedAtom } from "@/state/calendar-navigation";

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
    label: "Search tasks",
    view: "search-tasks",
  },
  {
    icon: PlusCircleIcon,
    id: "create-task",
    label: "Create task",
    view: "create-task",
  },
];

export function CommandBarRoot({ onNavigate }: CommandBarRootProps) {
  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);
  const requestCreateEvent = useSetAtom(createEventRequestedAtom);
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
        <CommandItem
          onSelect={() => {
            setCommandBarOpen(false);
            requestCreateEvent(true);
          }}
          value="Create event"
        >
          <CalendarPlusIcon className="text-muted-foreground" />
          <span>Create event</span>
          <Kbd className="ml-auto">C</Kbd>
        </CommandItem>
      </CommandGroup>
    </>
  );
}
