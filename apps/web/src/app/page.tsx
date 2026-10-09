import type { Metadata } from "next";
import HomePageClient from "./home-page-client";

export const metadata: Metadata = {
  description:
    "Plan your week with one timeline for calendar events, tasks, and connected accounts.",
  title: "Kompose - Calendar and Tasks",
};

export default function HomePage() {
  return <HomePageClient />;
}
