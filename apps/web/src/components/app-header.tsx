"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import { useTags } from "@kompose/state/hooks/use-tags";
import type { User } from "better-auth";
import { useSetAtom } from "jotai";
import { LogOut, Search, Settings, Tag as TagIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { type TagIconName, tagIconMap } from "./tags/tag-icon-map";
import { TagIconPicker } from "./tags/tag-icon-picker";

/**
 * App-wide header bar with:
 * - Left: Traffic light safe area (blank space for macOS window controls)
 * - Center: Search bar that opens command palette (cmd+k)
 * - Right: User avatar with dropdown menu
 *
 * The header is draggable in Tauri for window movement.
 * On web, looks identical but without drag functionality.
 */
export function AppHeader() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

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
        {user && <TagsMenu />}
        {user && <UserMenu user={user} />}
      </div>
    </header>
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
function UserMenu({ user }: { user: User }) {
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
          <AvatarImage alt={user.name} src={user.image || ""} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" sideOffset={8}>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
            <Avatar className="size-8">
              <AvatarImage alt={user.name} src={user.image || ""} />
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
  const { tagsQuery, createTag, deleteTag } = useTags();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<TagIconName>("Tag");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const tags = tagsQuery.data ?? [];

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
        <PopoverContent align="end" className="w-72 p-3">
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                Tags
              </div>
              {tags.length === 0 ? (
                <div className="text-muted-foreground text-sm">
                  No tags yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {tags.map((tag) => {
                    const Icon = tagIconMap[tag.icon];
                    return (
                      <div
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                        key={tag.id}
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{tag.name}</span>
                        <Button
                          className="h-7 w-7 cursor-pointer"
                          onClick={() =>
                            setDeleteTarget({ id: tag.id, name: tag.name })
                          }
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span className="sr-only">Delete tag</span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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
