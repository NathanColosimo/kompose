import type { PluginConnection } from "@kompose/api/routers/plugins/contract";
import { isOAuthPlugin, type OAuthPlugin, plugins } from "@kompose/plugins";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { useStateConfig } from "../config";
import { GOOGLE_ACCOUNT_INFO_QUERY_KEY } from "../google-calendar-query-keys";

export const PLUGIN_CONNECTIONS_QUERY_KEY = ["plugin-connections"] as const;

/** One Settings card: an OAuth plugin and the accounts connected to it. */
export interface PluginCard {
  connections: PluginConnection[];
  /** The plugin allows one account and has it, so Connect is disabled. */
  isFull: boolean;
  plugin: OAuthPlugin;
}

/**
 * The plugins the user connected, connecting one through `linkAccount`, and
 * disconnecting one by unlinking its account. See documents/plugins.md.
 */
export function usePluginConnections(
  /** Starts the provider's sign-in; resolves once it is done or under way. */
  linkAccount: (plugin: OAuthPlugin) => Promise<unknown>
) {
  const queryClient = useQueryClient();
  const { authClient, orpc } = useStateConfig();

  const connectionsQuery = useQuery({
    queryFn: () => orpc.plugins.connections(),
    queryKey: PLUGIN_CONNECTIONS_QUERY_KEY,
  });

  const cards: PluginCard[] = plugins.filter(isOAuthPlugin).map((plugin) => {
    const connections = (connectionsQuery.data ?? []).filter(
      (connection) => connection.pluginId === plugin.id
    );
    return {
      connections,
      isFull: !plugin.connection.multipleAccounts && connections.length > 0,
      plugin,
    };
  });

  /** Refetch after connecting or disconnecting an account. */
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: PLUGIN_CONNECTIONS_QUERY_KEY });
    // The calendar and WHOOP views still read linked accounts directly.
    queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY });
  };

  const connect = useMutation({ mutationFn: linkAccount, onSuccess: refresh });

  const disconnect = useMutation({
    mutationFn: (accountId: string) => authClient.unlinkAccount({ accountId }),
    onSuccess: refresh,
  });

  return { cards, connect, connectionsQuery, disconnect, refresh };
}

/** The label for a card's Connect button. */
export function connectLabel(
  card: PluginCard,
  options: { connecting: boolean; inBrowser?: boolean }
): string {
  if (options.connecting) {
    return "Connecting…";
  }
  if (card.isFull) {
    return "Connected";
  }
  if (options.inBrowser) {
    return "Connect in browser";
  }
  if (card.connections.length > 0) {
    return "Connect another account";
  }
  return "Connect";
}

/** Up to two initials for an avatar without an image. */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
