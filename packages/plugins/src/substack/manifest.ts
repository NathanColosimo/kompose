import type { PluginManifest } from "../types";

export const substack = {
  connection: { kind: "none" },
  description: "Titles and reading times for Substack posts.",
  id: "substack",
  name: "Substack",
} as const satisfies PluginManifest;
