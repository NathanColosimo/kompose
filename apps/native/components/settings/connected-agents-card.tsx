import { useConnectedAgents } from "@kompose/state/hooks/use-connected-agents";
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
import { env } from "@/lib/env";

const MCP_URL = `${env.EXPO_PUBLIC_SERVER_URL}/api/mcp`;

/** AI apps connected over MCP, each revocable. See documents/mcp.md. */
export function ConnectedAgentsCard() {
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
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>AI Agents</CardTitle>
        <CardDescription>
          Let ChatGPT, Claude, and other MCP apps manage your tasks. Add this
          URL as a custom connector in the app:
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <Text className="font-mono text-xs" selectable>
          {MCP_URL}
        </Text>

        {agentsQuery.isLoading ? (
          <Text className="text-muted-foreground text-sm">Loading agents…</Text>
        ) : null}

        {agentsQuery.isSuccess && agents.length === 0 ? (
          <Text className="text-muted-foreground text-sm">
            No agents connected yet.
          </Text>
        ) : null}

        {agents.map((agent) => (
          <View
            className="rounded-xl border border-border p-3"
            key={agent.clientId}
          >
            <View className="flex-row items-center gap-3">
              {agent.icon ? (
                <Image
                  source={{ uri: agent.icon }}
                  style={{ borderRadius: 20, height: 40, width: 40 }}
                />
              ) : (
                <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <Text className="font-semibold text-xs">
                    {agent.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <View className="min-w-0 flex-1 gap-1">
                <Text className="font-semibold text-sm">{agent.name}</Text>
                <Text className="text-muted-foreground text-xs">
                  Connected {new Date(agent.connectedAt).toLocaleDateString()}
                </Text>
              </View>
              <Button
                accessibilityLabel={`Remove ${agent.name}`}
                disabled={revokeAgent.isPending}
                icon={Unlink2}
                loading={
                  revokeAgent.isPending &&
                  revokeAgent.variables === agent.clientId
                }
                onPress={() => confirmRevoke(agent.clientId, agent.name)}
                size="icon"
                variant="destructive"
              />
            </View>
          </View>
        ))}
      </CardContent>
    </Card>
  );
}
