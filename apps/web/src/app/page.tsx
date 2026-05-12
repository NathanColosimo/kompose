import type { Metadata } from "next";
import HomePageClient from "./home-page-client";

export const metadata: Metadata = {
  title: "Kompose - Calendar, Tasks, and AI Copilot",
  description:
    "Plan your week with one timeline for calendar events, tasks, integrations, and AI-assisted scheduling.",
};

export default function HomePage() {
  return <HomePageClient />;
}
