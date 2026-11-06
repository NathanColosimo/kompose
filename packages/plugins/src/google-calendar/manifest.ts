import type { PluginManifest } from "../types";

export const googleCalendar = {
  connection: { kind: "oauth", multipleAccounts: true, provider: "google" },
  description: "Calendars and events from your Google accounts.",
  id: "google-calendar",
  name: "Google Calendar",
} as const satisfies PluginManifest;
