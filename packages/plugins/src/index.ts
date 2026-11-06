import { googleCalendar } from "./google-calendar/manifest";
import { spotify } from "./spotify/manifest";
import { substack } from "./substack/manifest";
import type { OAuthConnection, PluginManifest } from "./types";
import { whoop } from "./whoop/manifest";
import { youtube } from "./youtube/manifest";

/** Every plugin built into Kompose. */
export const plugins = [
  googleCalendar,
  whoop,
  spotify,
  youtube,
  substack,
] as const;

/** Better Auth providers whose accounts connect a plugin. */
export type OAuthProvider = Extract<
  (typeof plugins)[number]["connection"],
  OAuthConnection
>["provider"];

/** A plugin the user connects an account to; Settings lists these. */
export type OAuthPlugin = PluginManifest & { connection: OAuthConnection };

export function isOAuthPlugin<P extends PluginManifest>(
  plugin: P
): plugin is Extract<P, OAuthPlugin> {
  return plugin.connection.kind === "oauth";
}

/** The plugin an OAuth account from this Better Auth provider connects. */
export function getPluginForProvider(
  providerId: string
): PluginManifest | undefined {
  return plugins.find(
    (plugin) =>
      isOAuthPlugin(plugin) && plugin.connection.provider === providerId
  );
}

export type {
  OAuthConnection,
  PluginManifest,
} from "./types";
