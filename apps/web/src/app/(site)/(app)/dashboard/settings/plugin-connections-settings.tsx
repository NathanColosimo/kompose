"use client";

import { clientEnv } from "@kompose/env/client";
import { usePluginConnections } from "@kompose/state/hooks/use-plugin-connections";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, extractAuthErrorMessage } from "@/lib/auth-client";
import {
  SettingsEmpty,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsSection,
} from "./settings-section";

/** A section per plugin with its linked accounts. See documents/plugins.md. */
export function PluginConnectionsSettings({
  isDesktop,
}: {
  isDesktop: boolean;
}) {
  const { connectionsQuery, link, refresh, sections, unlink } =
    usePluginConnections(async (plugin) => {
      if (isDesktop) {
        window.open(`${clientEnv.NEXT_PUBLIC_WEB_URL}/dashboard/settings`);
        return;
      }
      // Redirects to the provider, which returns to this page.
      const callbackURL = `${window.location.origin}/dashboard/settings`;
      const result = await authClient.linkSocial({
        callbackURL,
        errorCallbackURL: callbackURL,
        provider: plugin.provider,
      });
      const authError = extractAuthErrorMessage(result);
      if (authError) {
        throw new Error(authError);
      }
    });

  useMountEffect(() => {
    // The desktop app links accounts in the system browser; refresh on return.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  });

  return sections.map(({ canLink, connections, plugin }) => {
    let linkLabel = isDesktop ? "Link in browser" : "Link account";
    if (link.isPending && link.variables.id === plugin.id) {
      linkLabel = "Linking…";
    }
    return (
      <SettingsSection
        action={
          canLink ? (
            <Button
              disabled={link.isPending}
              onClick={() =>
                link.mutate(plugin, {
                  onError: (error) => toast.error(error.message),
                })
              }
              variant="outline"
            >
              <Plus />
              {linkLabel}
              <span className="sr-only"> for {plugin.name}</span>
            </Button>
          ) : null
        }
        description={plugin.description}
        key={plugin.id}
        title={plugin.name}
      >
        {connectionsQuery.isPending ? <SettingsRowSkeleton /> : null}
        {connectionsQuery.isError ? (
          <SettingsEmpty>Couldn't load linked accounts.</SettingsEmpty>
        ) : null}
        {connectionsQuery.isSuccess && connections.length === 0 ? (
          <SettingsEmpty>No account linked.</SettingsEmpty>
        ) : null}
        {connections.map((connection) => {
          const name = connection.name || `${plugin.name} account`;
          return (
            <SettingsRow
              action={
                <Button
                  className="hover:bg-destructive/10 hover:text-destructive"
                  disabled={unlink.isPending || link.isPending}
                  onClick={() =>
                    unlink.mutate(connection.accountId, {
                      onError: (error) => toast.error(error.message),
                      onSuccess: () =>
                        toast.success(`${plugin.name} account unlinked.`),
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {unlink.isPending && unlink.variables === connection.accountId
                    ? "Unlinking…"
                    : "Unlink"}
                  <span className="sr-only"> {connection.email || name}</span>
                </Button>
              }
              detail={connection.email || "Email unavailable"}
              image={connection.image}
              key={connection.id}
              name={name}
            />
          );
        })}
      </SettingsSection>
    );
  });
}
