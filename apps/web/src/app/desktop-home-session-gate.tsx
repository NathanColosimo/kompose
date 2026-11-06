"use client";

import { useRouter } from "next/navigation";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";

function DashboardRedirect() {
  const { replace } = useRouter();

  useMountEffect(() => {
    replace("/dashboard");
  });

  return null;
}

/** In the desktop app, send a signed-in user straight to the dashboard. */
export function DesktopHomeSessionGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return null;
  }

  return session?.user ? <DashboardRedirect /> : children;
}
