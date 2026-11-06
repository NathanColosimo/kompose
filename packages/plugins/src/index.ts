import { googleCalendar } from "./google-calendar/manifest";
import type { PluginManifest } from "./types";
import { whoop } from "./whoop/manifest";

/** Every plugin built into Kompose. */
export const plugins = [googleCalendar, whoop] as const;

/** The plugin an OAuth account from this Better Auth provider connects. */
export function getPluginForProvider(
  providerId: string
): PluginManifest | undefined {
  return plugins.find(
    (plugin) =>
      plugin.connection.kind === "oauth" &&
      plugin.connection.provider === providerId
  );
}

export type { PluginManifest } from "./types";
