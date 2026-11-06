import type { PluginManifest } from "../types";

export const spotify = {
  connection: { kind: "server-key" },
  description: "Titles and lengths for Spotify tracks, episodes, and albums.",
  id: "spotify",
  name: "Spotify",
} as const satisfies PluginManifest;
