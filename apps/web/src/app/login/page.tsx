import type { Metadata } from "next";
import LoginPageClient from "./login-page-client";

export const metadata: Metadata = {
  description: "Sign in or create a Kompose account to manage your schedule.",
  title: "Sign in - Kompose",
};

export default function LoginPage() {
  return <LoginPageClient />;
}
