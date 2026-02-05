import { ScrollView, View } from "react-native";
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
import { clearSessionQueries } from "@/utils/orpc";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="p-4">
        {/* Theme toggle */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>Choose your preferred appearance</CardDescription>
          </CardHeader>
          <CardContent>
            <ModeToggle />
          </CardContent>
        </Card>

        {/* Account section - only shown when signed in */}
        {session?.user ? (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>{session.user.email}</CardDescription>
            </CardHeader>
            <CardContent className="gap-2">
              <Text className="text-sm">
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
