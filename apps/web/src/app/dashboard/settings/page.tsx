import type { Metadata } from "next";
import SettingsPageClient from "./settings-page-client";

export const metadata: Metadata = {
  description: "Manage your Kompose account and connected integrations.",
  title: "Settings - Kompose",
};

export default function SettingsPage() {
  return <SettingsPageClient />;
}
