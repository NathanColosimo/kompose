"use client";

import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { todayTickAtom } from "../atoms/current-date";

const REFRESH_INTERVAL_MS = 60_000;

/** Web subscribes to focus/visibility; native subscribes to AppState active transitions. */
export type SubscribeToResume = (refresh: () => void) => () => void;

/** Refresh today/now every minute and on resume so an open app stays correct across midnight. */
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
