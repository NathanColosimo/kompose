"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient, getElectronAuthQuery } from "@/lib/auth-client";
import { extractAuthErrorMessage, isDesktopRuntime } from "@/lib/desktop";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type SocialProvider = "google" | "apple";

interface SocialAccountButtonsProps {
  mode: "sign-in" | "sign-up";
}

const copyByMode = {
  "sign-in": {
    appleLabel: "Continue with Apple",
    applePendingLabel: "Connecting to Apple...",
    desktopPendingLabel: "Opening browser...",
    googleLabel: "Continue with Google",
    googlePendingLabel: "Connecting to Google...",
    successMessage: "Signed in. Redirecting to your workspace.",
  },
  "sign-up": {
    appleLabel: "Create with Apple",
    applePendingLabel: "Contacting Apple...",
    desktopPendingLabel: "Opening browser...",
    googleLabel: "Create with Google",
    googlePendingLabel: "Contacting Google...",
    successMessage: "You're in! Redirecting to your timeline.",
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
  const lastUsedMethod = authClient.getLastUsedLoginMethod();

  const handleSocialSignIn = async (provider: SocialProvider) => {
    if (activeProvider) {
      return;
    }

    setActiveProvider(provider);

    try {
      // Better Auth owns PKCE and the session exchange in the main process.
      if (isDesktopRuntime()) {
        await window.requestAuth({ provider });
        // The official plugin reports completion through onAuthenticated.
        return;
      }

      // Web flow: runs OAuth inside the browser tab via Better Auth client.
      const { callbackURL, errorCallbackURL, newUserCallbackURL } =
        buildSocialAuthUrls();

      const query = getElectronAuthQuery();
      const result = await authClient.signIn.social({
        provider,
        ...(query ? { fetchOptions: { query } } : {}),
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
        {lastUsedMethod === "google" && activeProvider !== "google" ? (
          <Badge className="ml-2" variant="secondary">
            Last used
          </Badge>
        ) : null}
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
        {lastUsedMethod === "apple" && activeProvider !== "apple" ? (
          <Badge className="ml-2" variant="secondary">
            Last used
          </Badge>
        ) : null}
      </Button>
    </div>
  );
}
