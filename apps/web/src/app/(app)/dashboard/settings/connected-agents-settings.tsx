"use client";

import { clientEnv } from "@kompose/env/client";
import { useConnectedAgents } from "@kompose/state/hooks/use-connected-agents";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  SettingsEmpty,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsSection,
} from "./settings-section";

const MCP_URL = `${clientEnv.NEXT_PUBLIC_WEB_URL}/api/mcp`;

/** AI apps connected over MCP, each revocable. See documents/mcp.md. */
export function ConnectedAgentsSettings() {
  const { agentsQuery, revokeAgent } = useConnectedAgents();
  const agents = agentsQuery.data ?? [];

  const copyUrl = async () => {
    await navigator.clipboard.writeText(MCP_URL);
    toast.success("MCP URL copied.");
  };

  const revoke = (clientId: string, name: string) =>
    revokeAgent.mutate(clientId, {
      onError: () => toast.error(`Failed to remove ${name}.`),
      onSuccess: () => toast.success(`${name} can no longer use Kompose.`),
    });

  return (
    <SettingsSection
      description="Let ChatGPT, Claude, and other MCP apps manage your tasks. Add this URL as a custom connector in the app."
      title="AI agents"
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">
          {MCP_URL}
        </code>
        <Button onClick={copyUrl} size="sm" type="button" variant="outline">
          <Copy />
          Copy
        </Button>
      </div>
      {agentsQuery.isLoading ? <SettingsRowSkeleton /> : null}
      {agentsQuery.isSuccess && agents.length === 0 ? (
        <SettingsEmpty>No apps connected yet.</SettingsEmpty>
      ) : null}
      {agents.map((agent) => (
        <SettingsRow
          action={
            <Button
              className="hover:bg-destructive/10 hover:text-destructive"
              disabled={revokeAgent.isPending}
              onClick={() => revoke(agent.clientId, agent.name)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {revokeAgent.isPending && revokeAgent.variables === agent.clientId
                ? "Removing…"
                : "Remove"}
              <span className="sr-only"> {agent.name}</span>
            </Button>
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
