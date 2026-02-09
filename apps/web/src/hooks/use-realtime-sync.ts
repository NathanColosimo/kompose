"use client";

import { useRealtimeSync } from "@kompose/state/hooks/use-realtime-sync";
import { authClient } from "@/lib/auth-client";

export function useWebRealtimeSync() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;

  useRealtimeSync({
    enabled: Boolean(userId),
    userId,
  });
}
