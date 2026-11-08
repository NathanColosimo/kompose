"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  authClient,
  extractAuthErrorMessage,
  getElectronAuthQuery,
} from "@/lib/auth-client";
import { Button } from "../ui/button";

const PROVIDERS = [
  {
    id: "google",
    label: "Continue with Google",
    name: "Google",
    variant: "default",
  },
  {
    id: "apple",
    label: "Continue with Apple",
    name: "Apple",
    variant: "outline",
  },
] as const;

type SocialProvider = (typeof PROVIDERS)[number]["id"];

function buildSocialAuthUrls() {
  const baseUrl = window.location.origin;
  return {
    callbackURL: `${baseUrl}/dashboard`,
    errorCallbackURL: `${baseUrl}/login`,
  };
}

export function SocialAccountButtons() {
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
      // Runs OAuth in this browser tab. A desktop sign-in request in the URL
      // is forwarded so the app receives the session afterwards.
      const { callbackURL, errorCallbackURL } = buildSocialAuthUrls();

      const query = getElectronAuthQuery();
      const result = await authClient.signIn.social({
        provider,
        ...(query ? { fetchOptions: { query } } : {}),
        callbackURL,
        errorCallbackURL,
      });

      const authError = extractAuthErrorMessage(result);
      if (authError) {
        toast.error(authError);
        return;
      }

      toast.success("Signed in. Opening your workspace…");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setActiveProvider(null);
    }
  };

  const lastUsed = PROVIDERS.find(({ id }) => id === lastUsedMethod);

  return (
    <div className="flex flex-col gap-2.5">
      {PROVIDERS.map(({ id, label, variant }) => (
        <Button
          className="h-10 w-full text-sm"
          disabled={activeProvider !== null}
          key={id}
          onClick={() => handleSocialSignIn(id)}
          type="button"
          variant={variant}
        >
          {activeProvider === id ? "Connecting…" : label}
        </Button>
      ))}
      {lastUsed ? (
        <p className="text-center text-muted-foreground text-xs">
          You last signed in with {lastUsed.name}.
        </p>
      ) : null}
    </div>
  );
}
