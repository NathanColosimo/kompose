"use client";

import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { todayTickAtom } from "../atoms/current-date";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Platform-specific resume subscriber type.
 * Called with a refresh callback; returns an unsubscribe function.
 *
 * Web: listen to visibilitychange + focus.
 * Native: listen to AppState "active" transitions.
 */
export type SubscribeToResume = (refresh: () => void) => () => void;

/**
 * Keeps todayPlainDateAtom and nowZonedDateTimeAtom fresh by incrementing
 * todayTickAtom every 60 seconds. Optionally accepts a platform-specific
 * resume subscriber for immediate refresh on app foreground.
 *
 * Mounted in StateProvider — each platform passes its own subscriber.
 */
export function useTodayTick(subscribeToResume?: SubscribeToResume) {
  const setTick = useSetAtom(todayTickAtom);

  useEffect(() => {
    const refresh = () => setTick((prev) => prev + 1);

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    const unsubscribeResume = subscribeToResume?.(refresh);

    return () => {
      clearInterval(interval);
      unsubscribeResume?.();
    };
  }, [setTick, subscribeToResume]);
}
