"use client";

import { hasSessionAtom } from "@kompose/state/config";
import { useRealtimeSync } from "@kompose/state/hooks/use-realtime-sync";
import { useAtomValue } from "jotai";

export function useWebRealtimeSync() {
  // Reuse shared session presence state to avoid another get-session subscriber.
  const hasSession = useAtomValue(hasSessionAtom);

  useRealtimeSync({
    enabled: hasSession,
    // Realtime hook only needs a truthy identifier gate for web.
    userId: hasSession ? "active-session" : undefined,
  });
}
