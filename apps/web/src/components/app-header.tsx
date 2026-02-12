"use client";

import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useGoogleAccountProfiles } from "@kompose/state/hooks/use-google-account-profiles";
import { useTags } from "@kompose/state/hooks/use-tags";
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
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
import { authClient } from "@/lib/auth-client";
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
export function AppHeader({ user }: { user: User }) {
  const { profiles: googleAccountProfiles } = useGoogleAccountProfiles();
  const fallbackGoogleAvatar = useMemo(() => {
    const email = user.email?.toLowerCase();
    if (!email) {
      return googleAccountProfiles[0]?.profile?.image || "";
    }

    const matchedProfile = googleAccountProfiles.find(
      (entry) => entry.profile?.email?.toLowerCase() === email
    )?.profile;

    return (
      matchedProfile?.image || googleAccountProfiles[0]?.profile?.image || ""
    );
  }, [googleAccountProfiles, user]);
  const avatarSrc = user?.image || fallbackGoogleAvatar || "";

  return (
    <header
      className="flex h-10 shrink-0 items-center border-b bg-background px-2"
      // Tauri v2 uses data-tauri-drag-region for window dragging (no effect on web)
      data-tauri-drag-region
    >
      {/* Left: Traffic light safe area (~76px for macOS traffic lights) */}
      <div className="w-[76px] shrink-0" data-tauri-drag-region />

      {/* Center: Search bar - container is draggable, button is not */}
      <div className="flex flex-1 justify-center" data-tauri-drag-region>
        <SearchButton />
      </div>

      {/* Right: User menu - container is draggable, dropdown is not */}
      <div
        className="flex shrink-0 items-center justify-end gap-2 pr-1"
        data-tauri-drag-region
      >
        <ChatToggleButton />
        <UpdatePromptButton />
        <TagsMenu />
        <UserMenu avatarSrc={avatarSrc} user={user} />
      </div>
    </header>
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
        "flex h-7 w-full max-w-md items-center gap-2 rounded-md border bg-muted/50 px-3 text-muted-foreground text-sm transition-colors",
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

  const handleLogout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
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
  const { isReadyToInstall, isInstalling, installUpdate } = useTauriUpdater();
  const [open, setOpen] = useState(false);

  // Only show the restart affordance once an update is downloaded.
  if (!isReadyToInstall) {
    return null;
  }

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        <Button
          aria-label="Restart to apply update"
          className="relative"
          size="icon"
          type="button"
          variant="ghost"
        >
          <RotateCw className="h-4 w-4" />
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update ready</AlertDialogTitle>
          <AlertDialogDescription>
            A new version has been downloaded. Restart Kompose to apply the
            update now.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isInstalling}>Later</AlertDialogCancel>
          <AlertDialogAction
            disabled={isInstalling}
            onClick={async () => {
              setOpen(false);
              await installUpdate();
            }}
          >
            Restart now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
