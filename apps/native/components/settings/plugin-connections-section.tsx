import { usePluginConnections } from "@kompose/state/hooks/use-plugin-connections";
import { createURL } from "expo-linking";
import { Plus } from "lucide-react-native";
import { Pressable, Alert as RNAlert, View } from "react-native";
import {
  RowAction,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-section";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";

/** A section per plugin with its linked accounts. See documents/plugins.md. */
export function PluginConnectionsSections() {
  const { connectionsQuery, link, sections, unlink } = usePluginConnections(
    (plugin) =>
      // Resolves after the in-app browser closes.
      authClient.linkSocial({
        callbackURL: createURL("settings"),
        provider: plugin.provider,
      })
  );

  return sections.map(({ canLink, connections, plugin }) => {
    let linkLabel = `Link a ${plugin.name} account`;
    if (link.isPending && link.variables.id === plugin.id) {
      linkLabel = "Linking…";
    } else if (connections.length > 0) {
      linkLabel = `Link another ${plugin.name} account`;
    }

    return (
      <SettingsSection
        description={plugin.description}
        key={plugin.id}
        title={plugin.name}
      >
        {connectionsQuery.isPending ? (
          <SettingsNote first>Loading accounts…</SettingsNote>
        ) : null}
        {connectionsQuery.isError ? (
          <SettingsNote first>Couldn't load linked accounts.</SettingsNote>
        ) : null}
        {connectionsQuery.isSuccess && connections.length === 0 ? (
          <SettingsNote first>No account linked yet.</SettingsNote>
        ) : null}
        {connections.map((connection, index) => {
          const name = connection.name || `${plugin.name} account`;
          return (
            <SettingsRow
              action={
                <RowAction
                  accessibilityLabel={`Unlink ${connection.email || name}`}
                  disabled={unlink.isPending || link.isPending}
                  label={
                    unlink.isPending &&
                    unlink.variables === connection.accountId
                      ? "Unlinking…"
                      : "Unlink"
                  }
                  onPress={() =>
                    unlink.mutate(connection.accountId, {
                      onError: (error) =>
                        RNAlert.alert(
                          "Failed to unlink account",
                          error.message
                        ),
                    })
                  }
                />
              }
              detail={connection.email}
              first={index === 0 && !connectionsQuery.isError}
              image={connection.image}
              key={connection.id}
              name={name}
            />
          );
        })}
        {canLink ? (
          <Pressable
            accessibilityRole="button"
            className="border-border active:bg-muted flex-row items-center gap-3 border-t px-4 py-3"
            disabled={link.isPending}
            onPress={() => link.mutate(plugin)}
          >
            <View className="border-border size-8 items-center justify-center rounded-full border border-dashed">
              <Icon as={Plus} className="text-muted-foreground" size={15} />
            </View>
            <Text className="text-foreground text-sm">{linkLabel}</Text>
          </Pressable>
        ) : null}
      </SettingsSection>
    );
  });
}
