import type { Metadata } from "next";
import SettingsPageClient from "./settings-page-client";

export const metadata: Metadata = {
  title: "Settings - Kompose",
  description: "Manage your Kompose account and connected integrations.",
};

export default function SettingsPage() {
  return <SettingsPageClient />;
}
