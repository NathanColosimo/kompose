"use client";

import { useRealtimeSync } from "@kompose/state/hooks/use-realtime-sync";

export function useWebRealtimeSync(userId?: string) {
  useRealtimeSync({
    enabled: Boolean(userId),
    userId,
  });
}
