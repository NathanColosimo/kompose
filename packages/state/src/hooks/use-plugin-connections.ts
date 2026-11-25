import type { PluginConnection } from "@kompose/api/routers/plugins/contract";
import { type Plugin, plugins } from "@kompose/plugins";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { useStateConfig } from "../config";

export const PLUGIN_CONNECTIONS_QUERY_KEY = ["plugin-connections"] as const;

/** One Settings section: a plugin and the accounts linked to it. */
export interface PluginSection {
  /** False once a plugin that allows one account has it. */
  canLink: boolean;
  connections: PluginConnection[];
  plugin: Plugin;
}

/** Every account the user linked to a plugin, with its name and email. */
export function usePluginConnectionsQuery() {
  const { orpc } = useStateConfig();
  return useQuery({
    queryFn: () => orpc.plugins.connections(),
    queryKey: PLUGIN_CONNECTIONS_QUERY_KEY,
    // Like the linked accounts list. Linking and unlinking refetch at once.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The accounts the user linked to each plugin, linking one through
 * `linkAccount`, and unlinking one. See documents/plugins.md.
 */
export function usePluginConnections(
  /** Starts the provider's sign-in; resolves once it is done or under way. */
  linkAccount: (plugin: Plugin) => Promise<unknown>
) {
  const queryClient = useQueryClient();
  const { authClient } = useStateConfig();
  const connectionsQuery = usePluginConnectionsQuery();

  const sections: PluginSection[] = plugins.map((plugin) => {
    const connections = (connectionsQuery.data ?? []).filter(
      (connection) => connection.pluginId === plugin.id
    );
    return {
      canLink: plugin.multipleAccounts || connections.length === 0,
      connections,
      plugin,
    };
  });

  /** Refetch after linking or unlinking an account. */
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: PLUGIN_CONNECTIONS_QUERY_KEY });
    // The calendar and WHOOP views read linked accounts directly.
    queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_QUERY_KEY });
  };

  const link = useMutation({ mutationFn: linkAccount, onSuccess: refresh });

  const unlink = useMutation({
    mutationFn: (accountId: string) => authClient.unlinkAccount({ accountId }),
    onSuccess: refresh,
  });

  return { connectionsQuery, link, refresh, sections, unlink };
}
