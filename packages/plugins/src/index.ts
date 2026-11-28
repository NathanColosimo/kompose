import { z } from "zod";

/**
 * Every plugin's ID, declared once. Use `PluginId` wherever code names a
 * plugin, and `pluginIdSchema` to check a string that comes from outside.
 * `connection.plugin_id` in the database is typed from this list.
 */
export const pluginIds = ["google-calendar", "whoop"] as const;
export const pluginIdSchema = z.enum(pluginIds);
export type PluginId = z.infer<typeof pluginIdSchema>;

/**
 * Every Better Auth provider whose accounts link a plugin, declared once.
 * `webhook_subscription.provider` in the database is typed from this list.
 */
export const pluginProviders = ["google", "whoop"] as const;
export const pluginProviderSchema = z.enum(pluginProviders);
export type PluginProvider = z.infer<typeof pluginProviderSchema>;

/**
 * An outside service a user links an account to. See documents/plugins.md.
 */
export interface Plugin {
  /**
   * The provider's accounts also sign in to Kompose (Google), or only link
   * this plugin (WHOOP). See documents/plugins.md.
   */
  canSignIn: boolean;
  /** One sentence for Settings. */
  description: string;
  /** Stored in `connection.plugin_id`, and the last part of the webhook URL. */
  id: PluginId;
  /** One user may link several accounts, or only one (WHOOP). */
  multipleAccounts: boolean;
  name: string;
  /** The Better Auth provider whose accounts link this plugin. */
  provider: PluginProvider;
}

/** Every plugin, in the order Settings lists them. */
export const plugins: readonly Plugin[] = [
  {
    canSignIn: true,
    description: "Events from these accounts show on your calendar.",
    id: "google-calendar",
    multipleAccounts: true,
    name: "Google Calendar",
    provider: "google",
  },
  {
    canSignIn: false,
    description:
      "Sleep, recovery, and workouts from one WHOOP account show on your calendar.",
    id: "whoop",
    multipleAccounts: false,
    name: "WHOOP",
    provider: "whoop",
  },
];

/** The plugin an account from this Better Auth provider links. */
export function getPluginForProvider(providerId: string): Plugin | undefined {
  return plugins.find((plugin) => plugin.provider === providerId);
}
