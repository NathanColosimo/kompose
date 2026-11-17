/**
 * An outside service a user links an account to. See documents/plugins.md.
 */
export interface Plugin {
  /** One sentence for Settings. */
  description: string;
  /** Stored in `connection.plugin_id`, and the last part of the webhook URL. */
  id: string;
  /** One user may link several accounts, or only one (WHOOP). */
  multipleAccounts: boolean;
  name: string;
  /** The Better Auth provider whose accounts link this plugin. */
  provider: string;
}

/** Every plugin, in the order Settings lists them. */
export const plugins = [
  {
    description: "Events from these accounts show on your calendar.",
    id: "google-calendar",
    multipleAccounts: true,
    name: "Google Calendar",
    provider: "google",
  },
  {
    description:
      "Sleep, recovery, and workouts from one WHOOP account show on your calendar.",
    id: "whoop",
    multipleAccounts: false,
    name: "WHOOP",
    provider: "whoop",
  },
] as const satisfies readonly Plugin[];

/** The plugin an account from this Better Auth provider links. */
export function getPluginForProvider(providerId: string): Plugin | undefined {
  return plugins.find((plugin) => plugin.provider === providerId);
}
