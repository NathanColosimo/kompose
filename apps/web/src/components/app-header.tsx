"use client";

import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { isProductionDeployment } from "@kompose/env";
import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "better-auth";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  LogOut,
  MessageSquareIcon,
  Plus,
  RotateCw,
  Search,
  Settings,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { clearTauriBearer, isTauriRuntime } from "@/lib/tauri-desktop";
import { cn } from "@/lib/utils";
import {
  dashboardResponsiveLayoutAtom,
  sidebarRightOpenAtom,
  sidebarRightOverlayOpenAtom,
} from "@/state/sidebar";
import { type TagIconName, tagIconMap } from "./tags/tag-icon-map";
import { TagIconPickerPopover } from "./tags/tag-icon-picker";
import { useTauriUpdater } from "./tauri-updater";

/**
 * App-wide header bar with:
 * - Left: Traffic light safe area (blank space for macOS window controls)
 * - Center: Search bar that opens command palette (cmd+k)
 * - Right: User avatar with dropdown menu
 *
 * The header is draggable in Tauri for window movement.
 * On web, looks identical but without drag functionality.
 */
export function AppHeader({ user }: { user: User | null }) {
  // Keep the header independent from linked-account profile fetches so
  // accountInfo only affects surfaces that actually render linked accounts.
  const avatarSrc = user?.image || "";

  return (
    <header className="relative flex h-10 shrink-0 items-center border-b bg-background px-2">
      {/* Full-header drag layer; interactive controls are rendered above this. */}
      <div aria-hidden className="absolute inset-0" data-tauri-drag-region />
      <div className="pointer-events-none relative z-10 flex w-full items-center">
        {/* Left: macOS traffic-light safe area stays non-interactive/draggable. */}
        <div className="w-[76px] shrink-0 select-none" />

        <div className="flex flex-1 justify-center">
          <SearchButton />
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center justify-end gap-2 pr-1">
          <ChatToggleButton />
          <UpdatePromptButton />
          <TagsMenu />
          {user ? (
            <UserMenu avatarSrc={avatarSrc} user={user} />
          ) : (
            <SignedOutAvatar />
          )}
        </div>
      </div>
    </header>
  );
}

function SignedOutAvatar() {
  return (
    <Avatar className="size-7">
      <AvatarFallback className="text-xs">?</AvatarFallback>
    </Avatar>
  );
}

function ChatToggleButton() {
  const responsiveLayout = useAtomValue(dashboardResponsiveLayoutAtom);
  const [rightSidebarOpen, setRightSidebarOpen] = useAtom(sidebarRightOpenAtom);
  const [rightOverlayOpen, setRightOverlayOpen] = useAtom(
    sidebarRightOverlayOpenAtom
  );

  const isOpen = responsiveLayout.canDockRightSidebar
    ? rightSidebarOpen
    : rightOverlayOpen;

  return (
    <Button
      className="size-7"
      onClick={() => {
        if (responsiveLayout.canDockRightSidebar) {
          setRightSidebarOpen((prev) => !prev);
          return;
        }
        setRightOverlayOpen((prev) => !prev);
      }}
      size="icon"
      type="button"
      variant={isOpen ? "secondary" : "outline"}
    >
      {isOpen ? (
        <X className="size-3.5" />
      ) : (
        <MessageSquareIcon className="size-3.5" />
      )}
      <span className="sr-only">{isOpen ? "Close chat" : "Open chat"}</span>
    </Button>
  );
}

/**
 * Fake search input that opens the command bar when clicked.
 * Shows placeholder text and ⌘K shortcut indicator.
 */
function SearchButton() {
  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);

  return (
    <button
      className={cn(
        "pointer-events-auto flex h-7 w-full max-w-md items-center gap-2 rounded-md border bg-muted/50 px-3 text-muted-foreground text-sm transition-colors",
        "hover:bg-muted hover:text-foreground"
      )}
      onClick={() => setCommandBarOpen(true)}
      type="button"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 text-left">Do Anything…</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

/**
 * User avatar dropdown with account options and logout.
 */
function UserMenu({ avatarSrc, user }: { avatarSrc: string; user: User }) {
  const { push, replace } = useRouter();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    clearTauriBearer();
    await authClient.signOut();
    await authClient
      .getSession({ query: { disableCookieCache: true } })
      .catch(() => null);
    queryClient.clear();
    replace("/login");
  };

  // Get initials for avatar fallback
  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <Avatar className="size-7 cursor-pointer">
          <AvatarImage alt={user.name} src={avatarSrc} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" sideOffset={8}>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
            <Avatar className="size-8">
              <AvatarImage alt={user.name} src={avatarSrc} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-muted-foreground text-xs">
                {user.email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => push("/dashboard/settings")}>
            <Settings className="mr-2 size-4" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagsMenu() {
  const { tagsQuery, createTag, updateTag, deleteTag } = useTags();
  const [open, setOpen] = useState(false);
  const tags = tagsQuery.data ?? [];

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button size="icon" type="button" variant="ghost">
          <TagIcon className="size-4" />
          <span className="sr-only">Tags</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0" sideOffset={8}>
        <div className="px-3 pt-2.5 pb-1">
          <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-widest">
            Tags
          </span>
        </div>

        {tags.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-3 py-5 text-center">
            <div className="flex size-9 items-center justify-center rounded-full bg-muted/50">
              <TagIcon className="size-4 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-xs">
              Tags help you organize tasks
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[240px]">
            <div className="px-1.5 py-0.5">
              {tags.map((tag) => (
                <TagRow
                  key={tag.id}
                  onDelete={(id) => deleteTag.mutateAsync(id)}
                  onUpdate={(input) => updateTag.mutate(input)}
                  tag={tag}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="border-t px-1.5 py-1">
          <CreateTagRow
            isPending={createTag.isPending}
            onCreate={(input) => createTag.mutateAsync(input)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TagRow({
  tag,
  onUpdate,
  onDelete,
}: {
  tag: TagSelect;
  onUpdate: (input: { id: string; name?: string; icon?: TagIconName }) => void;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(tag.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeletePending, setIsDeletePending] = useState(false);

  const prevTagName = useRef(tag.name);
  if (tag.name !== prevTagName.current) {
    prevTagName.current = tag.name;
    if (!editingName) {
      setName(tag.name);
    }
  }

  const inputCallbackRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const Icon = tagIconMap[tag.icon];

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== tag.name) {
      onUpdate({ id: tag.id, name: trimmed });
    } else {
      setName(tag.name);
    }
    setEditingName(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setName(tag.name);
      setEditingName(false);
    }
  };

  const handleDelete = async () => {
    setIsDeletePending(true);
    try {
      await onDelete(tag.id);
    } catch {
      setIsDeletePending(false);
      setConfirmDelete(false);
    }
  };

  if (confirmDelete) {
    return (
      <div className="flex h-8 items-center gap-1.5 rounded-md bg-destructive/10 px-2">
        <span className="flex-1 truncate text-destructive/80 text-xs">
          Delete &ldquo;{tag.name}&rdquo;?
        </span>
        <Button
          onClick={() => setConfirmDelete(false)}
          size="xs"
          type="button"
          variant="ghost"
        >
          No
        </Button>
        <Button
          disabled={isDeletePending}
          onClick={handleDelete}
          size="xs"
          type="button"
          variant="destructive"
        >
          {isDeletePending ? "…" : "Yes"}
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex h-8 items-center gap-1 rounded-md px-1.5 transition-colors duration-100 hover:bg-muted/50">
      <TagIconPickerPopover
        onChange={(icon) => onUpdate({ id: tag.id, icon })}
        value={tag.icon}
      >
        <Button
          className="text-muted-foreground"
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Icon className="size-3.5" />
        </Button>
      </TagIconPickerPopover>

      {editingName ? (
        <Input
          className="h-6 flex-1 bg-transparent"
          onBlur={saveName}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          ref={inputCallbackRef}
          value={name}
        />
      ) : (
        <button
          className="min-w-0 flex-1 cursor-text truncate px-1 text-left text-sm"
          onClick={() => setEditingName(true)}
          type="button"
        >
          {name}
        </button>
      )}

      <Button
        className="text-muted-foreground opacity-0 transition-all duration-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        onClick={() => setConfirmDelete(true)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

function CreateTagRow({
  onCreate,
  isPending,
}: {
  onCreate: (input: { name: string; icon: TagIconName }) => Promise<unknown>;
  isPending: boolean;
}) {
  const [active, setActive] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<TagIconName>("Tag");
  const inputRef = useRef<HTMLInputElement>(null);

  const inputCallbackRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el) {
      el.focus();
    }
  }, []);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || isPending) {
      return;
    }
    await onCreate({ name: trimmed, icon });
    setName("");
    setIcon("Tag");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setName("");
      setActive(false);
    }
  };

  const SelectedIcon = tagIconMap[icon];

  if (!active) {
    return (
      <Button
        className="w-full justify-start gap-1 px-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setActive(true)}
        size="lg"
        type="button"
        variant="ghost"
      >
        <div className="flex size-6 items-center justify-center">
          <Plus className="size-3.5" />
        </div>
        <span className="px-1 text-sm">New tag&hellip;</span>
      </Button>
    );
  }

  return (
    <div className="flex h-8 items-center gap-1 rounded-md px-1.5">
      <TagIconPickerPopover onChange={setIcon} value={icon}>
        <Button
          className="text-muted-foreground"
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <SelectedIcon className="size-3.5" />
        </Button>
      </TagIconPickerPopover>

      <Input
        className="h-6 flex-1 bg-transparent"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Tag name"
        ref={inputCallbackRef}
        value={name}
      />
    </div>
  );
}

function UpdatePromptButton() {
  const { checkForUpdates, installUpdate, status } = useTauriUpdater();
  const [open, setOpen] = useState(false);
  const isDesktopUpdaterVisible = isTauriRuntime() && isProductionDeployment;
  const isBusy =
    status === "checking" ||
    status === "downloading" ||
    status === "installing";

  if (!isDesktopUpdaterVisible) {
    return null;
  }

  let buttonLabel = "Check for updates";
  if (status === "ready") {
    buttonLabel = "Restart to apply update";
  } else if (status === "installing") {
    buttonLabel = "Installing update";
  } else if (status === "downloading") {
    buttonLabel = "Downloading update";
  } else if (status === "checking") {
    buttonLabel = "Checking for updates";
  }

  let tooltipLabel = "Click to check for updates";
  if (status === "ready") {
    tooltipLabel = "Click to restart and update";
  } else if (status === "installing") {
    tooltipLabel = "Currently installing update";
  } else if (status === "downloading") {
    tooltipLabel = "Currently downloading update";
  } else if (status === "checking") {
    tooltipLabel = "Currently checking for updates";
  }

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              aria-label={buttonLabel}
              className="relative"
              disabled={isBusy}
              onClick={async () => {
                if (status === "ready") {
                  setOpen(true);
                  return;
                }

                await checkForUpdates();
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <RotateCw className={cn("size-4", isBusy && "animate-spin")} />
              {status === "ready" ? (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-destructive" />
              ) : null}
              <span className="sr-only">{buttonLabel}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipLabel}</p>
        </TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update ready</AlertDialogTitle>
          <AlertDialogDescription>
            A new version has been downloaded. Restart Kompose to apply the
            update now.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={status === "installing"}>
            Later
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={status === "installing"}
            onClick={async () => {
              setOpen(false);
              await installUpdate();
            }}
          >
            {status === "installing" ? "Installing…" : "Restart now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
