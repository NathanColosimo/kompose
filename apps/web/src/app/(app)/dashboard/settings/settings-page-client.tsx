"use client";

import { clientEnv } from "@kompose/env/client";
import { LINKED_ACCOUNTS_QUERY_KEY } from "@kompose/state/account-query-keys";
import { whoopAccountDataAtom } from "@kompose/state/atoms/whoop-data";
import { GOOGLE_ACCOUNT_INFO_QUERY_KEY } from "@kompose/state/google-calendar-query-keys";
import { useGoogleAccountProfiles } from "@kompose/state/hooks/use-google-account-profiles";
import { useUnlinkGoogleAccount } from "@kompose/state/hooks/use-unlink-google-account";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, extractAuthErrorMessage } from "@/lib/auth-client";
import { isDesktopRuntime } from "@/lib/desktop";
import { orpc } from "@/utils/orpc";
import { ConnectedAgentsSettings } from "./connected-agents-settings";
import { DesktopShortcutSettings } from "./desktop-shortcut-settings";
import {
  SettingsEmpty,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsSection,
} from "./settings-section";

export default function SettingsPageClient() {
  const queryClient = useQueryClient();
  const unlinkGoogleAccount = useUnlinkGoogleAccount();
  const [linkingProvider, setLinkingProvider] = useState<
    "google" | "whoop" | null
  >(null);
  const [isDesktop, setIsDesktop] = useState(false);
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
    setIsDesktop(isDesktopRuntime());
    // The desktop app links accounts in the system browser; refresh on return.
    const refreshAccounts = () => {
      queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY,
      });
    };
    window.addEventListener("focus", refreshAccounts);
    return () => window.removeEventListener("focus", refreshAccounts);
  });

  const handleLinkAnotherGoogleAccount = async () => {
    if (linkingProvider !== null) {
      return;
    }

    setLinkingProvider("google");
    try {
      if (isDesktopRuntime()) {
        window.open(`${clientEnv.NEXT_PUBLIC_WEB_URL}/dashboard/settings`);
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
        window.open(`${clientEnv.NEXT_PUBLIC_WEB_URL}/dashboard/settings`);
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

  let googleLinkButtonLabel = isDesktop ? "Link in browser" : "Link account";
  if (linkingProvider === "google") {
    googleLinkButtonLabel = "Linking…";
  }
  let whoopLinkButtonLabel = isDesktop ? "Link in browser" : "Link account";
  if (linkingProvider === "whoop") {
    whoopLinkButtonLabel = "Linking…";
  }
  const isAccountActionPending =
    unlinkingAccountId !== null ||
    unlinkGoogleAccount.isPending ||
    linkingProvider !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <Button
          asChild
          className="text-muted-foreground"
          size="icon-lg"
          variant="ghost"
        >
          <Link aria-label="Back to calendar" href="/dashboard">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-medium text-base">Settings</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-8">
          {isDesktop ? (
            <p className="rounded-lg border bg-card px-4 py-3 text-muted-foreground text-sm">
              Accounts link in your browser. Sign in there with this Kompose
              account, then come back here.
            </p>
          ) : null}

          <SettingsSection
            action={
              <Button
                disabled={linkingProvider !== null}
                onClick={handleLinkAnotherGoogleAccount}
                variant="outline"
              >
                <Plus />
                {googleLinkButtonLabel}
              </Button>
            }
            description="Events from these accounts show on your calendar."
            title="Google Calendar"
          >
            {isLoading && googleAccountProfiles.length === 0 ? (
              <SettingsRowSkeleton />
            ) : null}
            {!isLoading && googleAccountProfiles.length === 0 ? (
              <SettingsEmpty>No Google accounts linked.</SettingsEmpty>
            ) : null}
            {googleAccountProfiles.map(
              ({ account, isLoading: isProfileLoading, profile }) =>
                isProfileLoading ? (
                  <SettingsRowSkeleton key={account.id} />
                ) : (
                  <SettingsRow
                    action={
                      <Button
                        className="hover:bg-destructive/10 hover:text-destructive"
                        disabled={isAccountActionPending}
                        onClick={() => handleUnlinkGoogleAccount(account.id)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {unlinkingAccountId === account.id
                          ? "Unlinking…"
                          : "Unlink"}
                      </Button>
                    }
                    detail={profile?.email || "Email unavailable"}
                    image={profile?.image}
                    key={account.id}
                    name={profile?.name || "Google account"}
                  />
                )
            )}
          </SettingsSection>

          <SettingsSection
            action={
              whoopAccounts.length === 0 ? (
                <Button
                  disabled={linkingProvider !== null}
                  onClick={handleLinkWhoopAccount}
                  variant="outline"
                >
                  <Plus />
                  {whoopLinkButtonLabel}
                </Button>
              ) : null
            }
            description="Sleep, recovery, and workouts from one WHOOP account show on your calendar."
            title="WHOOP"
          >
            {whoopAccounts.length === 0 ? (
              <SettingsEmpty>No WHOOP account linked.</SettingsEmpty>
            ) : null}
            {whoopAccounts.map((account, index) => {
              const profileQuery = whoopProfileQueries[index];
              const profile = profileQuery?.data;
              if (profileQuery?.isLoading) {
                return <SettingsRowSkeleton key={account.id} />;
              }

              return (
                <SettingsRow
                  action={
                    <Button
                      className="hover:bg-destructive/10 hover:text-destructive"
                      disabled={
                        unlinkingAccountId !== null || linkingProvider !== null
                      }
                      onClick={() => handleUnlinkWhoopAccount(account.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {unlinkingAccountId === account.id
                        ? "Unlinking…"
                        : "Unlink"}
                    </Button>
                  }
                  detail={profile?.email || "Email unavailable"}
                  key={account.id}
                  name={
                    [profile?.firstName, profile?.lastName]
                      .filter(Boolean)
                      .join(" ") || "WHOOP account"
                  }
                />
              );
            })}
          </SettingsSection>

          <ConnectedAgentsSettings />

          {isDesktop ? <DesktopShortcutSettings /> : null}
        </div>
      </div>
    </div>
  );
}
