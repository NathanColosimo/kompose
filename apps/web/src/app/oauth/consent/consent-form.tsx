"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { authClient, extractAuthErrorMessage } from "@/lib/auth-client";

/** Plain-language descriptions of the scopes an MCP client can request. */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  email: "See your email address",
  offline_access: "Stay connected until you remove it in Settings",
  openid: "Know which Kompose account is yours",
  profile: "See your name and profile picture",
  tasks: "See, create, edit, and delete your tasks, and see your tags",
};

interface ConsentFormProps {
  client: { icon: string | null; name: string; uri: string | null };
  scopes: string[];
  userEmail: string;
}

export function ConsentForm({ client, scopes, userEmail }: ConsentFormProps) {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // oauthProviderClient attaches this page's signed query to the request.
  const respond = async (accept: boolean) => {
    setPending(accept ? "allow" : "deny");
    setSubmitError(null);
    const result = await authClient.oauth2.consent({ accept });
    const message = extractAuthErrorMessage(result);
    if (message || !result.data?.url) {
      setSubmitError(message ?? "Something went wrong. Try again.");
      setPending(null);
      return;
    }
    window.location.href = result.data.url;
  };

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <Avatar className="size-14">
          {client.icon ? (
            <AvatarImage alt={client.name} src={client.icon} />
          ) : null}
          <AvatarFallback>
            {client.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <h1 className="font-serif text-2xl">
          Allow {client.name} to use Kompose?
        </h1>
        {client.uri ? (
          <p className="break-all text-muted-foreground text-xs">
            {client.uri}
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          Signed in as {userEmail}
        </p>
      </div>
      <div className="space-y-2">
        <p className="font-medium text-sm">It will be able to:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {scopes.map((scope) => (
            <li key={scope}>{SCOPE_DESCRIPTIONS[scope] ?? scope}</li>
          ))}
        </ul>
      </div>
      {submitError ? (
        <p className="text-destructive text-sm">{submitError}</p>
      ) : null}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          disabled={pending !== null}
          onClick={() => respond(false)}
          type="button"
          variant="outline"
        >
          {pending === "deny" ? "Cancelling…" : "Cancel"}
        </Button>
        <Button
          className="flex-1"
          disabled={pending !== null}
          onClick={() => respond(true)}
          type="button"
        >
          {pending === "allow" ? "Allowing…" : "Allow"}
        </Button>
      </div>
    </>
  );
}
