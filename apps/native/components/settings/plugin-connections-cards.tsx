import type { PluginManifest } from "@kompose/plugins";
import {
  connectLabel,
  initials,
  usePluginConnections,
} from "@kompose/state/hooks/use-plugin-connections";
import { createURL } from "expo-linking";
import { Unlink2 } from "lucide-react-native";
import { Image, Alert as RNAlert, View } from "react-native";
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

/** A card per plugin with its connected accounts. See documents/plugins.md. */
export function PluginConnectionsCards() {
  const { cards, connect, connectionsQuery, disconnect } = usePluginConnections(
    (plugin: PluginManifest) =>
      // Resolves after the in-app browser closes.
      authClient.linkSocial({
        callbackURL: createURL("settings"),
        provider: plugin.connection.provider,
      })
  );

  const confirmDisconnect = (accountId: string, name: string) => {
    RNAlert.alert(`Disconnect ${name}?`, undefined, [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () =>
          disconnect.mutate(accountId, {
            onError: (error) =>
              RNAlert.alert(`Failed to disconnect ${name}`, error.message),
          }),
        style: "destructive",
        text: "Disconnect",
      },
    ]);
  };

  return cards.map((card) => {
    const { connections, isFull, plugin } = card;
    return (
      <Card className="mb-4" key={plugin.id}>
        <CardHeader>
          <CardTitle>{plugin.name}</CardTitle>
          <CardDescription>{plugin.description}</CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <Button
            disabled={connect.isPending || isFull}
            onPress={() => connect.mutate(plugin)}
          >
            <Text className="text-primary-foreground">
              {connectLabel(card, {
                connecting:
                  connect.isPending && connect.variables.id === plugin.id,
              })}
            </Text>
          </Button>

          {connectionsQuery.isLoading ? (
            <Text className="text-muted-foreground text-sm">
              Loading accounts…
            </Text>
          ) : null}

          {connections.map((connection) => (
            <View
              className="rounded-xl border border-border p-3"
              key={connection.id}
            >
              <View className="flex-row items-center gap-3">
                {connection.image ? (
                  <Image
                    source={{ uri: connection.image }}
                    style={{ borderRadius: 20, height: 40, width: 40 }}
                  />
                ) : (
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Text className="font-semibold text-xs">
                      {initials(connection.name || plugin.name)}
                    </Text>
                  </View>
                )}
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-semibold text-sm" selectable>
                    {connection.name || "Unknown user"}
                  </Text>
                  <Text className="text-muted-foreground text-xs" selectable>
                    {connection.email || "Email unavailable"}
                  </Text>
                </View>
                <Button
                  accessibilityLabel={`Disconnect ${plugin.name}`}
                  disabled={disconnect.isPending}
                  icon={Unlink2}
                  loading={
                    disconnect.isPending &&
                    disconnect.variables === connection.accountId
                  }
                  onPress={() =>
                    confirmDisconnect(connection.accountId, plugin.name)
                  }
                  size="icon"
                  variant="destructive"
                />
              </View>
            </View>
          ))}
        </CardContent>
      </Card>
    );
  });
}
