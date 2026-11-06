import { ScrollView, View } from "react-native";
import { ModeToggle } from "@/components/mode-toggle";
import { ConnectedAgentsCard } from "@/components/settings/connected-agents-card";
import { PluginConnectionsCards } from "@/components/settings/plugin-connections-cards";
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
import { clearAuthenticatedQueries } from "@/utils/orpc";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();

  const handleSignOut = async () => {
    await authClient.signOut();
    clearAuthenticatedQueries();
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

        {session?.user ? <PluginConnectionsCards /> : null}

        {session?.user ? <ConnectedAgentsCard /> : null}

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
              <Button onPress={handleSignOut} variant="destructive">
                <Text className="text-destructive-foreground">Sign Out</Text>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
