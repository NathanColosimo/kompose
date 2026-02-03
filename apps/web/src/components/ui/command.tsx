import { Command as CommandPrimitive } from "cmdk";
import { CheckIcon, SearchIcon } from "lucide-react";
// biome-ignore lint/performance/noNamespaceImport: Imported component
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

type CommandSize = "sm" | "md" | "lg";

const CommandSizeContext = React.createContext<CommandSize>("md");

function useCommandSize() {
  return React.useContext(CommandSizeContext);
}

function Command({
  className,
  size = "md",
  ...props
}: React.ComponentProps<typeof CommandPrimitive> & { size?: CommandSize }) {
  const isLarge = size === "lg";

  return (
    <CommandSizeContext.Provider value={size}>
      <CommandPrimitive
        className={cn(
          "flex size-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground",
          isLarge && "p-2",
          className
        )}
        data-size={size}
        data-slot="command"
        {...props}
      />
    </CommandSizeContext.Provider>
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  size = "md",
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  size?: CommandSize;
}) {
  const isLarge = size === "lg";

  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          isLarge && "sm:max-w-md!",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  const size = useCommandSize();
  const isLarge = size === "lg";

  return (
    <div
      className={cn("p-1 pb-0", isLarge && "p-2 pb-1")}
      data-slot="command-input-wrapper"
    >
      <InputGroup
        className={cn(
          "bg-input/20 dark:bg-input/30",
          isLarge ? "h-10!" : "h-8!"
        )}
      >
        <CommandPrimitive.Input
          className={cn(
            "w-full text-xs/relaxed outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            isLarge && "text-sm/relaxed",
            className
          )}
          data-slot="command-input"
          {...props}
        />
        <InputGroupAddon className={cn(isLarge && "text-sm/relaxed")}>
          <SearchIcon
            className={cn("size-3.5 shrink-0 opacity-50", isLarge && "size-4")}
          />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  const size = useCommandSize();
  const isLarge = size === "lg";

  return (
    <CommandPrimitive.List
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-y-auto overflow-x-hidden outline-none",
        isLarge && "max-h-80 scroll-py-2",
        className
      )}
      data-slot="command-list"
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  const size = useCommandSize();
  const isLarge = size === "lg";

  return (
    <CommandPrimitive.Empty
      className={cn(
        "py-6 text-center text-xs/relaxed",
        isLarge && "text-sm/relaxed",
        className
      )}
      data-slot="command-empty"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  const size = useCommandSize();
  const isLarge = size === "lg";

  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:text-xs",
        isLarge &&
          "p-2 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-sm",
        className
      )}
      data-slot="command-group"
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  const size = useCommandSize();
  const isLarge = size === "lg";

  return (
    <CommandPrimitive.Separator
      className={cn(
        "-mx-1 my-1 h-px bg-border/50",
        isLarge && "my-1.5",
        className
      )}
      data-slot="command-separator"
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  const size = useCommandSize();
  const isLarge = size === "lg";

  return (
    <CommandPrimitive.Item
      className={cn(
        "group/command-item relative flex min-h-7 cursor-default select-none items-center gap-2 in-data-[slot=dialog-content]:rounded-md rounded-md px-2.5 py-1.5 text-xs/relaxed outline-hidden data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 data-[selected=true]:*:[svg]:text-accent-foreground",
        isLarge &&
          "min-h-9 px-3.5 py-2 text-sm/relaxed [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      data-slot="command-item"
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const size = useCommandSize();
  const isLarge = size === "lg";

  return (
    <span
      className={cn(
        "ml-auto text-[0.625rem] text-muted-foreground tracking-widest group-data-[selected=true]/command-item:text-foreground",
        isLarge && "text-xs",
        className
      )}
      data-slot="command-shortcut"
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
