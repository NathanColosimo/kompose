import { useConnectedAgents } from "@kompose/state/hooks/use-connected-agents";
import { Alert as RNAlert, View } from "react-native";
import {
  RowAction,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-section";
import { Text } from "@/components/ui/text";
import { env } from "@/lib/env";

const MCP_URL = `${env.EXPO_PUBLIC_SERVER_URL}/api/mcp`;

/** AI apps connected over MCP, each revocable. See documents/mcp.md. */
export function ConnectedAgentsSection() {
  const { agentsQuery, revokeAgent } = useConnectedAgents();
  const agents = agentsQuery.data ?? [];

  const confirmRevoke = (clientId: string, name: string) => {
    RNAlert.alert(
      `Remove ${name}?`,
      "It will immediately lose access to your tasks.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () =>
            revokeAgent.mutate(clientId, {
              onError: () =>
                RNAlert.alert("Failed to remove agent", "Please try again."),
            }),
          style: "destructive",
          text: "Remove",
        },
      ]
    );
  };

  return (
    <SettingsSection
      description="Let ChatGPT, Claude, and other MCP apps manage your tasks. Add this URL as a custom connector in the app."
      title="AI agents"
    >
      <View className="px-4 py-3">
        <Text className="font-mono text-foreground text-xs" selectable>
          {MCP_URL}
        </Text>
      </View>

      {agentsQuery.isLoading ? (
        <SettingsNote>Loading apps…</SettingsNote>
      ) : null}

      {agentsQuery.isSuccess && agents.length === 0 ? (
        <SettingsNote>No apps connected yet.</SettingsNote>
      ) : null}

      {agents.map((agent) => (
        <SettingsRow
          action={
            <RowAction
              accessibilityLabel={`Remove ${agent.name}`}
              destructive
              disabled={revokeAgent.isPending}
              label={
                revokeAgent.isPending &&
                revokeAgent.variables === agent.clientId
                  ? "Removing…"
                  : "Remove"
              }
              onPress={() => confirmRevoke(agent.clientId, agent.name)}
            />
          }
          detail={`Connected ${new Date(agent.connectedAt).toLocaleDateString()}`}
          image={agent.icon}
          key={agent.clientId}
          name={agent.name}
        />
      ))}
    </SettingsSection>
  );
}
