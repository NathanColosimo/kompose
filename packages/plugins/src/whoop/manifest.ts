import type { PluginManifest } from "../types";

export const whoop = {
  connection: { kind: "oauth", multipleAccounts: false, provider: "whoop" },
  description: "Recovery, sleep, and workouts from WHOOP.",
  id: "whoop",
  name: "WHOOP",
} as const satisfies PluginManifest;
