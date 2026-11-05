"use client";

import { env } from "@kompose/env";
import { useConnectedAgents } from "@kompose/state/hooks/use-connected-agents";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MCP_URL = `${env.NEXT_PUBLIC_WEB_URL}/api/mcp`;

/** AI apps connected over MCP, each revocable. See documents/mcp.md. */
export function ConnectedAgentsSettings() {
  const { agentsQuery, revokeAgent } = useConnectedAgents();
  const agents = agentsQuery.data ?? [];

  const copyUrl = async () => {
    await navigator.clipboard.writeText(MCP_URL);
    toast.success("MCP server URL copied.");
  };

  const revoke = (clientId: string, name: string) =>
    revokeAgent.mutate(clientId, {
      onError: () => toast.error(`Failed to remove ${name}.`),
      onSuccess: () => toast.success(`${name} can no longer use Kompose.`),
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>AI Agents</CardTitle>
            <CardDescription>
              Let ChatGPT, Claude, and other MCP apps manage your tasks. Add{" "}
              <code className="break-all">{MCP_URL}</code> as a custom connector
              in the app.
            </CardDescription>
          </div>
          <Button onClick={copyUrl} type="button" variant="outline">
            Copy URL
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {agentsQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading agents…</p>
        ) : null}
        {agentsQuery.isSuccess && agents.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No agents connected yet.
          </p>
        ) : null}
        {agents.map((agent) => (
          <div className="rounded-lg border p-3" key={agent.clientId}>
            <div className="flex items-center gap-3">
              <Avatar className="size-10">
                {agent.icon ? (
                  <AvatarImage alt={agent.name} src={agent.icon} />
                ) : null}
                <AvatarFallback>
                  {agent.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{agent.name}</p>
                <p className="truncate text-muted-foreground text-xs">
                  Connected {new Date(agent.connectedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                className="ml-auto"
                disabled={revokeAgent.isPending}
                onClick={() => revoke(agent.clientId, agent.name)}
                size="sm"
                type="button"
                variant="destructive"
              >
                {revokeAgent.isPending &&
                revokeAgent.variables === agent.clientId
                  ? "Removing..."
                  : "Remove"}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
