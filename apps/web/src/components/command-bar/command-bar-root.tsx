"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useSetAtom } from "jotai";
import { CalendarPlusIcon, ListTodoIcon, PlusCircleIcon } from "lucide-react";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useRequestCreateEvent } from "@/hooks/use-request-create-event";

type CommandBarView = "root" | "search-tasks" | "create-task";

interface CommandBarRootProps {
  /** False in the desktop popup, which is a separate window from the calendar. */
  canCreateEvent: boolean;
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

export function CommandBarRoot({
  canCreateEvent,
  onNavigate,
}: CommandBarRootProps) {
  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);
  const requestCreateEvent = useRequestCreateEvent();
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
        {canCreateEvent && (
          <CommandItem
            onSelect={() => {
              setCommandBarOpen(false);
              requestCreateEvent();
            }}
            value="Create event"
          >
            <CalendarPlusIcon className="text-muted-foreground" />
            <span>Create event</span>
            <CommandShortcut>
              <Kbd>C</Kbd>
            </CommandShortcut>
          </CommandItem>
        )}
      </CommandGroup>
    </>
  );
}
