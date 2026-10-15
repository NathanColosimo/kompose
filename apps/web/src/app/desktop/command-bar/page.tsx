import type { Metadata } from "next";
import DesktopCommandBarClient from "./desktop-command-bar-client";

export const metadata: Metadata = {
  description: "Desktop command bar popup for Kompose.",
  title: "Command Bar - Kompose",
};

export default function DesktopCommandBarPage() {
  return <DesktopCommandBarClient />;
}
