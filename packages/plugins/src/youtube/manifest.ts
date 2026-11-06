import type { PluginManifest } from "../types";

export const youtube = {
  connection: { kind: "server-key" },
  description: "Titles and lengths for YouTube videos.",
  id: "youtube",
  name: "YouTube",
} as const satisfies PluginManifest;
