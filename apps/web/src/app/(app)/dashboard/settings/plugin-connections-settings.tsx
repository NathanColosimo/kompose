"use client";

import type { PluginConnection } from "@kompose/api/routers/plugins/contract";
import { clientEnv } from "@kompose/env/client";
import type { PluginManifest } from "@kompose/plugins";
import {
  connectLabel,
  initials,
  usePluginConnections,
} from "@kompose/state/hooks/use-plugin-connections";
import { useState } from "react";
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
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, extractAuthErrorMessage } from "@/lib/auth-client";
import { isDesktopRuntime } from "@/lib/desktop";

/** A card per plugin with its connected accounts. See documents/plugins.md. */
export function PluginConnectionsSettings() {
  const { cards, connectionsQuery, disconnect, refresh } =
    usePluginConnections();
  const [isDesktop, setIsDesktop] = useState(false);
  const [connectingPluginId, setConnectingPluginId] = useState<string | null>(
    null
  );

  useMountEffect(() => {
    setIsDesktop(isDesktopRuntime());
    // The desktop app connects in the system browser; refresh on return.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  });

  const connect = async (plugin: PluginManifest) => {
    if (isDesktop) {
      window.open(`${clientEnv.NEXT_PUBLIC_WEB_URL}/dashboard/settings`);
      return;
    }
    setConnectingPluginId(plugin.id);
    try {
      // Redirects to the provider, which returns to this page.
      const callbackURL = `${window.location.origin}/dashboard/settings`;
      const result = await authClient.linkSocial({
        callbackURL,
        errorCallbackURL: callbackURL,
        provider: plugin.connection.provider,
      });
      const authError = extractAuthErrorMessage(result);
      if (authError) {
        toast.error(authError);
      }
    } finally {
      setConnectingPluginId(null);
    }
  };

  const disconnectAccount = (connection: PluginConnection, name: string) =>
    disconnect.mutate(connection.accountId, {
      onError: (error) => toast.error(error.message),
      onSuccess: () => toast.success(`${name} disconnected.`),
    });

  return cards.map((card) => {
    const { connections, isFull, plugin } = card;
    return (
      <Card key={plugin.id}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>{plugin.name}</CardTitle>
              <CardDescription>{plugin.description}</CardDescription>
            </div>
            <Button
              disabled={connectingPluginId !== null || isFull}
              onClick={() => connect(plugin)}
            >
              {connectLabel(card, {
                connecting: connectingPluginId === plugin.id,
                inBrowser: isDesktop,
              })}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {connectionsQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading accounts…</p>
          ) : null}
          {connectionsQuery.isSuccess && connections.length === 0 ? (
            <p className="text-muted-foreground text-sm">Not connected yet.</p>
          ) : null}
          {connections.map((connection) => (
            <div className="rounded-lg border p-3" key={connection.id}>
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  {connection.image ? (
                    <AvatarImage alt={connection.name} src={connection.image} />
                  ) : null}
                  <AvatarFallback>
                    {initials(connection.name || plugin.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {connection.name || "Unknown user"}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {connection.email || "Email unavailable"}
                  </p>
                </div>
                <Button
                  className="ml-auto"
                  disabled={disconnect.isPending}
                  onClick={() => disconnectAccount(connection, plugin.name)}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {disconnect.isPending &&
                  disconnect.variables === connection.accountId
                    ? "Disconnecting..."
                    : "Disconnect"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  });
}
