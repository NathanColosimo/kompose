import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";

const CONNECTED_AGENTS_QUERY_KEY = ["connected-agents"] as const;

/** AI agents (MCP clients) the user has allowed to use their account. */
export function useConnectedAgents() {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();

  const agentsQuery = useQuery({
    queryFn: () => orpc.agents.list(),
    queryKey: CONNECTED_AGENTS_QUERY_KEY,
  });

  const revokeAgent = useMutation({
    mutationFn: (clientId: string) => orpc.agents.revoke({ clientId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: CONNECTED_AGENTS_QUERY_KEY }),
  });

  return { agentsQuery, revokeAgent };
}
