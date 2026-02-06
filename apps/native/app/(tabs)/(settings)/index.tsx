import { useGoogleAccountProfiles } from "@kompose/state/hooks/use-google-account-profiles";
import { useUnlinkGoogleAccount } from "@kompose/state/hooks/use-unlink-google-account";
import { useQueryClient } from "@tanstack/react-query";
import { createURL } from "expo-linking";
import { Unlink2 } from "lucide-react-native";
import { useState } from "react";
import { Image, Alert as RNAlert, ScrollView, View } from "react-native";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import { clearSessionQueries, invalidateSessionQueries } from "@/utils/orpc";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
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
          provider: "google",
          callbackURL,
        },
        {
          onSuccess: () => {
            invalidateSessionQueries();
            queryClient.invalidateQueries({ queryKey: ["google-accounts"] });
            queryClient.invalidateQueries({
              queryKey: ["google-account-info"],
            });
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
      invalidateSessionQueries();
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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="p-4">
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>Choose your preferred appearance</CardDescription>
          </CardHeader>
          <CardContent>
            <ModeToggle />
          </CardContent>
        </Card>

        {session?.user ? (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Google Accounts</CardTitle>
              <CardDescription>
                Linked accounts used for Google Calendar access.
              </CardDescription>
            </CardHeader>
            <CardContent className="gap-3">
              <Button
                disabled={isLinking}
                onPress={handleLinkAnotherGoogleAccount}
              >
                <Text>
                  {isLinking ? "Linking…" : "Link another Google account"}
                </Text>
              </Button>

              {isLoading ? (
                <Text className="text-muted-foreground text-sm">
                  Loading Google accounts…
                </Text>
              ) : null}

              {!isLoading && googleAccountProfiles.length === 0 ? (
                <Text className="text-muted-foreground text-sm">
                  No Google accounts linked yet.
                </Text>
              ) : null}

              {googleAccountProfiles.map(
                ({ account, isLoading: isProfileLoading, profile }) => {
                  const displayName = profile?.name || "Unknown user";
                  const displayEmail = profile?.email || "Email unavailable";
                  const avatarSrc = profile?.image;
                  const avatarFallback = displayName
                    .split(" ")
                    .map((segment) => segment[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <View
                      className="rounded-xl border border-border p-3"
                      key={account.id}
                    >
                      <View className="flex-row items-center gap-3">
                        {avatarSrc ? (
                          <Image
                            source={{ uri: avatarSrc }}
                            style={{ height: 40, width: 40, borderRadius: 20 }}
                          />
                        ) : (
                          <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                            <Text className="font-semibold text-xs">
                              {avatarFallback || "G"}
                            </Text>
                          </View>
                        )}
                        <View className="min-w-0 flex-1 gap-1">
                          <Text className="font-semibold text-sm" selectable>
                            Google account
                            {isProfileLoading
                              ? " · Loading name..."
                              : ` · ${displayName}`}
                          </Text>
                          <Text
                            className="text-muted-foreground text-xs"
                            selectable
                          >
                            {isProfileLoading
                              ? "Loading email..."
                              : displayEmail}
                          </Text>
                        </View>
                        <Button
                          accessibilityLabel="Unlink Google account"
                          disabled={
                            isLinking ||
                            unlinkGoogleAccount.isPending ||
                            unlinkingAccountId !== null
                          }
                          icon={Unlink2}
                          loading={unlinkingAccountId === account.accountId}
                          onPress={() =>
                            handleUnlinkGoogleAccount(account.accountId)
                          }
                          size="icon"
                          variant="destructive"
                        />
                      </View>
                    </View>
                  );
                }
              )}
            </CardContent>
          </Card>
        ) : null}

        {session?.user ? (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>{session.user.email}</CardDescription>
            </CardHeader>
            <CardContent className="gap-2">
              <Text className="text-sm" selectable>
                Signed in as{" "}
                <Text className="font-semibold">{session.user.name}</Text>
              </Text>
              <Button
                onPress={() => {
                  authClient.signOut();
                  clearSessionQueries();
                }}
                variant="destructive"
              >
                <Text>Sign Out</Text>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
