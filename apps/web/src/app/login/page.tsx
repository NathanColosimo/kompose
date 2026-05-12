import type { Metadata } from "next";
import LoginPageClient from "./login-page-client";

export const metadata: Metadata = {
  title: "Sign in - Kompose",
  description: "Sign in or create a Kompose account to manage your schedule.",
};

export default function LoginPage() {
  return <LoginPageClient />;
}
