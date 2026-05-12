import type { Metadata } from "next";
import DesktopCommandBarClient from "./desktop-command-bar-client";

export const metadata: Metadata = {
  title: "Command Bar - Kompose",
  description: "Desktop command bar popup for Kompose.",
};

export default function DesktopCommandBarPage() {
  return <DesktopCommandBarClient />;
}
