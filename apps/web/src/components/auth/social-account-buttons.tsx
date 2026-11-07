"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  authClient,
  extractAuthErrorMessage,
  getElectronAuthQuery,
} from "@/lib/auth-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type SocialProvider = "google" | "apple";

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

  const providers = [
    { id: "google", label: "Continue with Google", variant: "default" },
    { id: "apple", label: "Continue with Apple", variant: "outline" },
  ] as const;

  return (
    <div className="flex flex-col gap-2.5">
      {providers.map(({ id, label, variant }) => (
        <Button
          className="relative h-10 w-full text-sm"
          disabled={activeProvider !== null}
          key={id}
          onClick={() => handleSocialSignIn(id)}
          type="button"
          variant={variant}
        >
          {activeProvider === id ? "Connecting…" : label}
          {lastUsedMethod === id && activeProvider !== id ? (
            <Badge
              className="absolute right-2.5 font-normal"
              variant="secondary"
            >
              Last used
            </Badge>
          ) : null}
        </Button>
      ))}
    </div>
  );
}
