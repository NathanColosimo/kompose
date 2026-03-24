"use client";

import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { isProductionDeployment } from "@kompose/env";
import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useTags } from "@kompose/state/hooks/use-tags";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "better-auth";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Check,
  LogOut,
  MessageSquareIcon,
  Pencil,
  RotateCw,
  Search,
  Settings,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { TagIconPicker } from "./tags/tag-icon-picker";
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
      className="h-7 w-7"
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
      <span className="flex-1 text-left">Do Anything...</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

/**
 * User avatar dropdown with account options and logout.
 */
function UserMenu({ avatarSrc, user }: { avatarSrc: string; user: User }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    // Clear the bearer token used by Tauri desktop before sign-out.
    clearTauriBearer();
    // Wait for sign-out response first.
    await authClient.signOut();
    // Force a fresh server-backed session read (bypass Better Auth cookie cache)
    // so route guards use authoritative signed-out state before redirect.
    await authClient
      .getSession({ query: { disableCookieCache: true } })
      .catch(() => null);
    queryClient.clear();
    router.replace("/login");
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
          <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
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
  const [isEditMode, setIsEditMode] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<TagIconName>("Tag");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState<TagIconName>("Tag");
  const [showIconPicker, setShowIconPicker] = useState(false);

  const tags = tagsQuery.data ?? [];

  useEffect(() => {
    if (!open) {
      setEditingTagId(null);
      setShowIconPicker(false);
      return;
    }

    if (tags.length === 0) {
      setIsEditMode(true);
    }
  }, [open, tags.length]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || createTag.isPending) {
      return;
    }

    createTag.mutate(
      { name: trimmed, icon },
      {
        onSuccess: () => {
          setName("");
        },
      }
    );
  };

  const startEditing = (tag: TagSelect, openPicker = false) => {
    setIsEditMode(true);
    setEditingTagId(tag.id);
    setEditName(tag.name);
    setEditIcon(tag.icon);
    setShowIconPicker(openPicker);
  };

  const handleSaveEdit = () => {
    if (!editingTagId || updateTag.isPending) {
      return;
    }
    const trimmed = editName.trim();
    if (!trimmed) {
      return;
    }
    updateTag.mutate(
      { id: editingTagId, name: trimmed, icon: editIcon },
      {
        onSuccess: () => {
          setEditingTagId(null);
          setShowIconPicker(false);
        },
      }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget || deleteTag.isPending) {
      return;
    }
    const targetId = deleteTarget.id;
    deleteTag.mutate(targetId, {
      onSettled: () => {
        setDeleteTarget(null);
      },
    });
  };

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button size="icon" type="button" variant="ghost">
            <TagIcon className="h-4 w-4" />
            <span className="sr-only">Tags</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  Tags
                </div>
                <Button
                  className="h-7 w-7"
                  onClick={() => {
                    if (tags.length === 0) {
                      setIsEditMode(true);
                      return;
                    }
                    setIsEditMode((prev) => !prev);
                    setEditingTagId(null);
                    setShowIconPicker(false);
                  }}
                  size="icon"
                  type="button"
                  variant={isEditMode ? "secondary" : "ghost"}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">
                    {isEditMode ? "Exit edit mode" : "Edit tags"}
                  </span>
                </Button>
              </div>
              {tags.length === 0 ? (
                <div className="text-muted-foreground text-sm">
                  No tags yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {tags.map((tag) => {
                    const Icon = tagIconMap[tag.icon];
                    const isEditing = editingTagId === tag.id;
                    return (
                      <div className="space-y-2" key={tag.id}>
                        <div
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                            isEditing && "border border-border"
                          )}
                        >
                          <button
                            className="flex items-center"
                            onClick={() => startEditing(tag, true)}
                            type="button"
                          >
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span className="sr-only">Edit tag icon</span>
                          </button>
                          {isEditing ? (
                            <>
                              <Input
                                className="h-8"
                                onChange={(event) =>
                                  setEditName(event.target.value)
                                }
                                value={editName}
                              />
                              <Button
                                className="h-7 w-7"
                                onClick={handleSaveEdit}
                                size="icon"
                                type="button"
                                variant="secondary"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span className="sr-only">Save tag</span>
                              </Button>
                              <Button
                                className="h-7 w-7"
                                onClick={() => {
                                  setEditingTagId(null);
                                  setShowIconPicker(false);
                                }}
                                size="icon"
                                type="button"
                                variant="ghost"
                              >
                                <X className="h-3.5 w-3.5" />
                                <span className="sr-only">Cancel edit</span>
                              </Button>
                            </>
                          ) : (
                            <>
                              <button
                                className="flex-1 truncate text-left"
                                onClick={() => startEditing(tag, false)}
                                type="button"
                              >
                                {tag.name}
                              </button>
                              {isEditMode ? (
                                <Button
                                  className="h-7 w-7 cursor-pointer"
                                  onClick={() =>
                                    setDeleteTarget({
                                      id: tag.id,
                                      name: tag.name,
                                    })
                                  }
                                  size="icon"
                                  type="button"
                                  variant="ghost"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  <span className="sr-only">Delete tag</span>
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                        {isEditing && showIconPicker ? (
                          <TagIconPicker
                            onChange={setEditIcon}
                            value={editIcon}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {isEditMode ? (
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="tag-name">Create tag</Label>
                <Input
                  id="tag-name"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Tag name"
                  value={name}
                />
                <TagIconPicker onChange={setIcon} value={icon} />
                <Button
                  className="w-full"
                  disabled={!name.trim() || createTag.isPending}
                  onClick={handleCreate}
                  type="button"
                >
                  {createTag.isPending ? "Creating..." : "Create tag"}
                </Button>
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTarget(null);
          }
        }}
        open={Boolean(deleteTarget)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the tag from all tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTag.isPending}
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
              <RotateCw className={cn("h-4 w-4", isBusy && "animate-spin")} />
              {status === "ready" ? (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
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
            {status === "installing" ? "Installing..." : "Restart now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
