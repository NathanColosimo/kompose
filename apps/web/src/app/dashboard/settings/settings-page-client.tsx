"use client";

import { env } from "@kompose/env";
import { LINKED_ACCOUNTS_QUERY_KEY } from "@kompose/state/account-query-keys";
import { whoopAccountDataAtom } from "@kompose/state/atoms/whoop-data";
import { GOOGLE_ACCOUNT_INFO_QUERY_KEY } from "@kompose/state/google-calendar-query-keys";
import { useGoogleAccountProfiles } from "@kompose/state/hooks/use-google-account-profiles";
import { useUnlinkGoogleAccount } from "@kompose/state/hooks/use-unlink-google-account";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import {
  desktopBridge,
  extractAuthErrorMessage,
  isDesktopRuntime,
  openUrlInDesktopBrowser,
} from "@/lib/desktop";
import { orpc } from "@/utils/orpc";
import { DesktopShortcutSettings } from "./desktop-shortcut-settings";

export default function SettingsPageClient() {
  const queryClient = useQueryClient();
  const unlinkGoogleAccount = useUnlinkGoogleAccount();
  const [linkingProvider, setLinkingProvider] = useState<
    "google" | "whoop" | null
  >(null);
  const [isDesktop, setIsDesktopRuntime] = useState(false);
  const [unlinkingAccountId, setUnlinkingAccountId] = useState<string | null>(
    null
  );
  const { profiles: googleAccountProfiles, isLoading } =
    useGoogleAccountProfiles();
  const whoopAccount = useAtomValue(whoopAccountDataAtom);
  const whoopAccounts = whoopAccount ? [whoopAccount] : [];

  const whoopProfileQueries = useQueries({
    queries: whoopAccounts.map((account) => ({
      queryFn: () => orpc.whoop.profile.get({ accountId: account.accountId }),
      queryKey: ["whoop-profile", account.accountId] as const,
      staleTime: 15 * 60 * 1000,
    })),
  });

  useMountEffect(() => {
    setIsDesktopRuntime(isDesktopRuntime());
    if (!isDesktopRuntime()) return;
    return desktopBridge().onWindowFocus((focused) => {
      if (!focused) return;
      queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY,
      });
    });
  });

  const handleLinkAnotherGoogleAccount = async () => {
    if (linkingProvider !== null) {
      return;
    }

    setLinkingProvider("google");
    try {
      if (isDesktopRuntime()) {
        await openUrlInDesktopBrowser(
          `${env.NEXT_PUBLIC_WEB_URL}/dashboard/settings`
        );
        return;
      }

      // Web flow: runs account linking inside the browser tab.
      const baseUrl = window.location.origin;
      const callbackURL = `${baseUrl}/dashboard/settings`;
      const errorCallbackURL = `${baseUrl}/dashboard/settings`;
      const result = await authClient.linkSocial({
        callbackURL,
        errorCallbackURL,
        provider: "google",
      });

      const authError = extractAuthErrorMessage(result);
      if (authError) {
        toast.error(authError);
        return;
      }

      toast.success("Google account linked.");
      queryClient.invalidateQueries({
        queryKey: LINKED_ACCOUNTS_QUERY_KEY,
      });
      queryClient.invalidateQueries({
        queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY,
      });
    } finally {
      setLinkingProvider(null);
    }
  };

  const handleLinkWhoopAccount = async () => {
    if (linkingProvider !== null || whoopAccounts.length >= 1) {
      return;
    }

    setLinkingProvider("whoop");

    try {
      if (isDesktopRuntime()) {
        await openUrlInDesktopBrowser(
          `${env.NEXT_PUBLIC_WEB_URL}/dashboard/settings`
        );
        return;
      }

      const baseUrl = window.location.origin;
      const callbackURL = `${baseUrl}/dashboard/settings`;
      const errorCallbackURL = `${baseUrl}/dashboard/settings`;
      const result = await authClient.linkSocial({
        callbackURL,
        errorCallbackURL,
        provider: "whoop",
      });

      const authError = extractAuthErrorMessage(result);
      if (authError) {
        toast.error(authError);
        return;
      }

      toast.success("WHOOP account link started.");
      queryClient.invalidateQueries({
        queryKey: LINKED_ACCOUNTS_QUERY_KEY,
      });
    } finally {
      setLinkingProvider(null);
    }
  };

  const handleUnlinkGoogleAccount = async (accountId: string) => {
    if (unlinkingAccountId || unlinkGoogleAccount.isPending) {
      return;
    }

    setUnlinkingAccountId(accountId);

    try {
      await unlinkGoogleAccount.mutateAsync({
        accountId,
      });
      toast.success("Google account unlinked.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to unlink Google account."
      );
    } finally {
      setUnlinkingAccountId(null);
    }
  };

  const handleUnlinkWhoopAccount = async (accountId: string) => {
    if (unlinkingAccountId || linkingProvider !== null) {
      return;
    }

    setUnlinkingAccountId(accountId);

    try {
      const { error } = await authClient.unlinkAccount({
        accountId,
      });
      if (error) {
        throw new Error(error.message ?? "Failed to unlink WHOOP account.");
      }
      toast.success("WHOOP account unlinked.");
      queryClient.invalidateQueries({
        queryKey: LINKED_ACCOUNTS_QUERY_KEY,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to unlink WHOOP account."
      );
    } finally {
      setUnlinkingAccountId(null);
    }
  };

  let whoopLinkButtonLabel = isDesktop
    ? "Link WHOOP in browser"
    : "Link WHOOP account";
  if (linkingProvider === "whoop") {
    whoopLinkButtonLabel = "Linking...";
  } else if (whoopAccounts.length >= 1) {
    whoopLinkButtonLabel = "WHOOP account linked";
  }

  return (
    <>
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink asChild>
                <Link href="/dashboard">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-2xl">Settings</h1>
          <p className="text-muted-foreground">
            Link and manage your Google and WHOOP accounts.
            {isDesktop
              ? " Link accounts in your browser using the same Kompose account, then return here."
              : null}
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Google Accounts</CardTitle>
                <CardDescription>
                  Linked accounts used for Google Calendar access.
                </CardDescription>
              </div>
              <Button
                disabled={linkingProvider !== null}
                onClick={handleLinkAnotherGoogleAccount}
              >
                {linkingProvider === "google"
                  ? "Linking..."
                  : isDesktop
                    ? "Link Google in browser"
                    : "Link another Google account"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading accounts…</p>
            ) : null}

            {!isLoading && googleAccountProfiles.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No Google accounts linked yet.
              </p>
            ) : null}

            {googleAccountProfiles.map(
              ({ account, isLoading: isProfileLoading, profile }) => {
                const displayName = profile?.name || "Unknown user";
                const displayEmail = profile?.email || "Email unavailable";
                const avatarSrc = profile?.image || "";
                const avatarFallback = displayName
                  .split(" ")
                  .map((segment) => segment[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <div className="rounded-lg border p-3" key={account.id}>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-10">
                        <AvatarImage alt={displayName} src={avatarSrc} />
                        <AvatarFallback>{avatarFallback || "G"}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-sm">
                          {isProfileLoading
                            ? "Loading name..."
                            : `${displayName}`}
                        </p>
                        <p className="truncate text-muted-foreground text-xs">
                          {isProfileLoading ? "Loading email..." : displayEmail}
                        </p>
                      </div>
                      <Button
                        className="ml-auto"
                        disabled={
                          unlinkingAccountId !== null ||
                          unlinkGoogleAccount.isPending ||
                          linkingProvider !== null
                        }
                        onClick={() => handleUnlinkGoogleAccount(account.id)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        {unlinkingAccountId === account.id
                          ? "Unlinking..."
                          : "Unlink"}
                      </Button>
                    </div>
                  </div>
                );
              }
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>WHOOP Account</CardTitle>
                <CardDescription>
                  Link one WHOOP account to sync sleep, recovery, and workouts.
                </CardDescription>
              </div>
              <Button
                disabled={linkingProvider !== null || whoopAccounts.length >= 1}
                onClick={handleLinkWhoopAccount}
              >
                {whoopLinkButtonLabel}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {whoopAccounts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No WHOOP account linked yet.
              </p>
            ) : null}

            {whoopAccounts.map((account, index) => {
              const profileQuery = whoopProfileQueries[index];
              const profile = profileQuery?.data;
              const isProfileLoading = Boolean(profileQuery?.isLoading);

              const displayName = profile
                ? [profile.firstName, profile.lastName]
                    .filter(Boolean)
                    .join(" ") || "Unknown user"
                : "Unknown user";
              const displayEmail = profile?.email || "Email unavailable";
              const avatarFallback = displayName
                .split(" ")
                .map((segment) => segment[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              return (
                <div className="rounded-lg border p-3" key={account.id}>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback>{avatarFallback || "W"}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">
                        {isProfileLoading ? "Loading name..." : displayName}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {isProfileLoading ? "Loading email..." : displayEmail}
                      </p>
                    </div>
                    <Button
                      className="ml-auto"
                      disabled={
                        unlinkingAccountId !== null || linkingProvider !== null
                      }
                      onClick={() => handleUnlinkWhoopAccount(account.id)}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      {unlinkingAccountId === account.id
                        ? "Unlinking..."
                        : "Unlink"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {isDesktop ? <DesktopShortcutSettings /> : null}
      </div>
    </>
  );
}
