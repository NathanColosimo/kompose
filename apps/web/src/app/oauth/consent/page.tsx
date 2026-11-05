import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { auth } from "@kompose/auth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = {
  title: "Allow access - Kompose",
};

/**
 * Better Auth redirects here during an MCP client's OAuth flow with a signed
 * query (client_id, scope, ...). Verify it server-side before showing it.
 */
function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md space-y-6 rounded-3xl border border-border/60 bg-card/80 p-8 shadow-lg">
        {children}
      </section>
    </main>
  );
}

function ConsentError({ message }: { message: string }) {
  return (
    <ConsentShell>
      <p className="text-center text-muted-foreground text-sm">{message}</p>
    </ConsentShell>
  );
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of [value ?? []].flat()) {
      query.append(key, item);
    }
  }

  const { secret } = await auth.$context;
  const clientId = query.get("client_id");
  if (!(clientId && (await verifyOAuthQueryParams(query.toString(), secret)))) {
    return (
      <ConsentError message="This authorization link is invalid or expired. Start connecting again from your AI app." />
    );
  }

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(`/login?${query.toString()}`);
  }

  const client = await auth.api
    .getOAuthClientPublic({
      headers: requestHeaders,
      query: { client_id: clientId },
    })
    .catch(() => null);
  if (!client) {
    return <ConsentError message="This app isn't registered with Kompose." />;
  }

  return (
    <ConsentShell>
      <ConsentForm
        client={{
          icon: client.logo_uri ?? null,
          name: client.client_name ?? client.client_uri ?? clientId,
          uri: client.client_uri ?? null,
        }}
        scopes={query.get("scope")?.split(" ").filter(Boolean) ?? []}
        userEmail={session.user.email}
      />
    </ConsentShell>
  );
}
