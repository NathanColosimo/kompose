import { useRealtimeSync } from "@kompose/state/hooks/use-realtime-sync";
import React from "react";
import { AppState } from "react-native";

export function useNativeRealtimeSync(userId?: string) {
  const [appState, setAppState] = React.useState(AppState.currentState);

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => {
      subscription.remove();
    };
  }, []);

  useRealtimeSync({
    enabled: Boolean(userId) && appState === "active",
    userId,
  });
}
