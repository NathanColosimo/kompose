"use client";

import { env } from "@kompose/env";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import {
  extractAuthErrorMessage,
  isTauriRuntime,
  openDesktopOAuth,
} from "@/lib/tauri-desktop";
import { Button } from "../ui/button";

type SocialProvider = "google" | "apple";

interface SocialAccountButtonsProps {
  mode: "sign-in" | "sign-up";
}

const copyByMode = {
  "sign-in": {
    successMessage: "Signed in. Redirecting to your workspace.",
    googleLabel: "Continue with Google",
    appleLabel: "Continue with Apple",
    googlePendingLabel: "Connecting to Google...",
    applePendingLabel: "Connecting to Apple...",
    desktopPendingLabel: "Opening browser...",
  },
  "sign-up": {
    successMessage: "You're in! Redirecting to your timeline.",
    googleLabel: "Create with Google",
    appleLabel: "Create with Apple",
    googlePendingLabel: "Contacting Google...",
    applePendingLabel: "Contacting Apple...",
    desktopPendingLabel: "Opening browser...",
  },
} as const;

function buildSocialAuthUrls() {
  const origin = window.location.origin;
  const baseUrl = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return {
    callbackURL: `${baseUrl}/dashboard`,
    errorCallbackURL: `${baseUrl}/login`,
    newUserCallbackURL: `${baseUrl}/dashboard`,
  };
}

export function SocialAccountButtons({ mode }: SocialAccountButtonsProps) {
  const [activeProvider, setActiveProvider] = useState<SocialProvider | null>(
    null
  );

  const handleSocialSignIn = async (provider: SocialProvider) => {
    if (activeProvider) {
      return;
    }

    setActiveProvider(provider);

    try {
      // On Tauri desktop, open the system browser for OAuth instead of
      // running the flow inside the webview. The DeepLinkHandler component
      // handles the kompose:// callback and completes the session exchange.
      if (isTauriRuntime()) {
        await openDesktopOAuth(provider, "sign-in", env.NEXT_PUBLIC_WEB_URL);
        // Don't clear activeProvider yet — the deep link handler will
        // navigate away once the callback arrives.
        return;
      }

      // Web flow: runs OAuth inside the browser tab via Better Auth client.
      const { callbackURL, errorCallbackURL, newUserCallbackURL } =
        buildSocialAuthUrls();

      const result = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL,
        ...(mode === "sign-up" ? { newUserCallbackURL } : {}),
      });

      const authError = extractAuthErrorMessage(result);
      if (authError) {
        toast.error(authError);
        return;
      }

      toast.success(copyByMode[mode].successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={activeProvider !== null}
        onClick={() => handleSocialSignIn("google")}
        size="lg"
        type="button"
      >
        {activeProvider === "google"
          ? copyByMode[mode].googlePendingLabel
          : copyByMode[mode].googleLabel}
      </Button>
      <Button
        className="w-full"
        disabled={activeProvider !== null}
        onClick={() => handleSocialSignIn("apple")}
        size="lg"
        type="button"
        variant="outline"
      >
        {activeProvider === "apple"
          ? copyByMode[mode].applePendingLabel
          : copyByMode[mode].appleLabel}
      </Button>
    </div>
  );
}
