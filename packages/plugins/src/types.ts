/** How a user connects a plugin. */
export interface OAuthConnection {
  kind: "oauth";
  /** One user may connect several accounts, or only one (WHOOP). */
  multipleAccounts: boolean;
  /** The Better Auth provider ID that links the account. */
  provider: string;
}

/** What Kompose knows about a plugin before running any of its code. */
export interface PluginManifest {
  connection: OAuthConnection;
  /** One sentence for Settings. */
  description: string;
  id: string;
  name: string;
}
