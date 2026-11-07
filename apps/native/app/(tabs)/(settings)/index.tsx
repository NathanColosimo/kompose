import { useGoogleAccountProfiles } from "@kompose/state/hooks/use-google-account-profiles";
import { useUnlinkGoogleAccount } from "@kompose/state/hooks/use-unlink-google-account";
import { createURL } from "expo-linking";
import { Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Alert as RNAlert, ScrollView, View } from "react-native";
import { ModeToggle } from "@/components/mode-toggle";
import { ConnectedAgentsSection } from "@/components/settings/connected-agents-card";
import {
  RowAction,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-section";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import {
  clearAuthenticatedQueries,
  invalidateAuthenticatedQueries,
} from "@/utils/orpc";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const unlinkGoogleAccount = useUnlinkGoogleAccount();
  const [isLinking, setIsLinking] = useState(false);
  const [unlinkingAccountId, setUnlinkingAccountId] = useState<string | null>(
    null
  );
  const { profiles: googleAccountProfiles, isLoading } =
    useGoogleAccountProfiles();

  const handleLinkAnotherGoogleAccount = async () => {
    if (isLinking) {
      return;
    }

    setIsLinking(true);

    const callbackURL = createURL("settings");

    try {
      await authClient.linkSocial(
        {
          callbackURL,
          provider: "google",
        },
        {
          onSuccess: () => {
            invalidateAuthenticatedQueries();
          },
        }
      );
    } finally {
      setIsLinking(false);
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
      invalidateAuthenticatedQueries();
    } catch (error) {
      RNAlert.alert(
        "Failed to unlink account",
        error instanceof Error
          ? error.message
          : "Unable to unlink this Google account."
      );
    } finally {
      setUnlinkingAccountId(null);
    }
  };

  let linkLabel = "Link another Google account";
  if (isLinking) {
    linkLabel = "Linking…";
  } else if (googleAccountProfiles.length === 0) {
    linkLabel = "Link a Google account";
  }

  const handleSignOut = async () => {
    await authClient.signOut();
    clearAuthenticatedQueries();
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="px-4 pt-4 pb-10">
        <SettingsSection title="Appearance">
          <ModeToggle />
        </SettingsSection>

        {session?.user ? (
          <SettingsSection
            description="Events from these accounts show on your calendar."
            title="Google Calendar"
          >
            {isLoading ? (
              <SettingsNote first>Loading accounts…</SettingsNote>
            ) : null}
            {!isLoading && googleAccountProfiles.length === 0 ? (
              <SettingsNote first>No Google accounts linked yet.</SettingsNote>
            ) : null}
            {googleAccountProfiles.map(
              ({ account, isLoading: isProfileLoading, profile }, index) => (
                <SettingsRow
                  action={
                    <RowAction
                      accessibilityLabel={`Unlink ${profile?.email ?? "Google account"}`}
                      destructive
                      disabled={
                        isLinking ||
                        unlinkGoogleAccount.isPending ||
                        unlinkingAccountId !== null
                      }
                      label={
                        unlinkingAccountId === account.id
                          ? "Unlinking…"
                          : "Unlink"
                      }
                      onPress={() => handleUnlinkGoogleAccount(account.id)}
                    />
                  }
                  detail={isProfileLoading ? "Loading…" : profile?.email}
                  first={index === 0 && !isLoading}
                  image={profile?.image}
                  key={account.id}
                  name={profile?.name || "Google account"}
                />
              )
            )}
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-3 border-border border-t px-4 py-3 active:bg-muted"
              disabled={isLinking}
              onPress={handleLinkAnotherGoogleAccount}
            >
              <View className="size-8 items-center justify-center rounded-full border border-border border-dashed">
                <Icon as={Plus} className="text-muted-foreground" size={15} />
              </View>
              <Text className="text-foreground text-sm">{linkLabel}</Text>
            </Pressable>
          </SettingsSection>
        ) : null}

        {session?.user ? <ConnectedAgentsSection /> : null}

        {session?.user ? (
          <SettingsSection title="Account">
            <SettingsRow
              action={
                <RowAction
                  destructive
                  label="Sign out"
                  onPress={handleSignOut}
                />
              }
              detail={session.user.email}
              first
              image={session.user.image}
              name={session.user.name}
            />
          </SettingsSection>
        ) : null}
      </View>
    </ScrollView>
  );
}
