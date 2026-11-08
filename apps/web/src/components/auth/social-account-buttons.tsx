"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMountEffect } from "@/hooks/use-mount-effect";
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
  const lastUsedMethod = authClient.getLastUsedLoginMethod();
  const signIn = useMutation({
    mutationFn: async (provider: SocialProvider) => {
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
        throw new Error(authError);
      }
    },
    onError: (error) => toast.error(error.message || "Sign-in failed."),
  });
  // Success means the browser is leaving for the provider's sign-in page, so
  // the buttons stay held until it does.
  const busy = signIn.isPending || signIn.isSuccess;
  const { reset } = signIn;

  // Back from the provider, the browser can restore this page as it was left,
  // held; release the buttons.
  useMountEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        reset();
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  });

  const lastUsed = PROVIDERS.find(({ id }) => id === lastUsedMethod);

  return (
    <div className="flex flex-col gap-2.5">
      {PROVIDERS.map(({ id, label, variant }) => (
        <Button
          className="h-10 w-full text-sm"
          disabled={busy}
          key={id}
          onClick={() => signIn.mutate(id)}
          type="button"
          variant={variant}
        >
          {busy && signIn.variables === id ? "Connecting…" : label}
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
