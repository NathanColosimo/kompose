"use client";

import type { User } from "better-auth";
import { useSetAtom } from "jotai";
import { LogOut, Search, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { commandBarOpenAtom } from "@/atoms/command-bar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

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
      className={cn(
        "flex h-10 shrink-0 items-center border-b bg-background px-2",
        // Make the header draggable in Tauri (no effect on web)
        "[--webkit-app-region:drag]"
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left: Traffic light safe area (~76px for macOS traffic lights) */}
      <div className="w-[76px] shrink-0" />

      {/* Center: Search bar */}
      <div className="flex flex-1 justify-center">
        <SearchButton />
      </div>

      {/* Right: User menu */}
      <div className="flex w-[76px] shrink-0 justify-end">
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
        "hover:bg-muted hover:text-foreground",
        // Prevent drag on interactive elements
        "[--webkit-app-region:no-drag]"
      )}
      onClick={() => setCommandBarOpen(true)}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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
      <DropdownMenuTrigger
        className="rounded-full outline-none ring-offset-background [--webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
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
