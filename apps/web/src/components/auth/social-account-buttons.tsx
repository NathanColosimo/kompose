"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
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
  },
  "sign-up": {
    successMessage: "You're in! Redirecting to your timeline.",
    googleLabel: "Create with Google",
    appleLabel: "Create with Apple",
    googlePendingLabel: "Contacting Google...",
    applePendingLabel: "Contacting Apple...",
  },
} as const;

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
      // Normalize origin and keep callback paths slashless. In desktop exports,
      // trailing-slash callback paths can fall back to home on some runtimes.
      const origin = window.location.origin;
      const baseUrl = origin.endsWith("/") ? origin.slice(0, -1) : origin;
      await authClient.signIn.social(
        {
          provider,
          callbackURL: `${baseUrl}/dashboard`,
          errorCallbackURL: `${baseUrl}/login`,
          ...(mode === "sign-up"
            ? { newUserCallbackURL: `${baseUrl}/dashboard` }
            : {}),
        },
        {
          onSuccess: () => {
            toast.success(copyByMode[mode].successMessage);
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        }
      );
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
