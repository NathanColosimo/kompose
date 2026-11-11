"use client";

import { GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID } from "@kompose/api/realtime/events";
import type { SyncEvent } from "@kompose/api/routers/sync/contract";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import { TASKS_QUERY_KEY } from "../atoms/tasks";
import { useStateConfig } from "../config";
import {
  GOOGLE_CALENDARS_QUERY_KEY,
  GOOGLE_EVENT_MASTER_QUERY_KEY,
  GOOGLE_EVENTS_QUERY_KEY,
  invalidateGoogleEventQueries,
} from "../google-calendar-query-keys";

const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY_MS = 30_000;
const BACKGROUND_DISCONNECT_DELAY_MS = 30_000;
// If no event (including keepalive) arrives within this window, assume the
// connection is dead and force a reconnect. Must be > server keepalive
// interval (10s) to avoid false positives.
const INACTIVITY_TIMEOUT_MS = 30_000;

export interface RealtimeSyncOptions {
  enabled?: boolean;
  foreground?: boolean;
  userId?: string;
}

interface RealtimeDocument {
  addEventListener?: (type: string, listener: () => void) => void;
  hasFocus?: () => boolean;
  removeEventListener?: (type: string, listener: () => void) => void;
  visibilityState?: string;
}

interface RealtimeWindow {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function getReconnectDelayMs(attempt: number): number {
  return Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt),
    MAX_RECONNECT_DELAY_MS
  );
}

function getRealtimeDocument(): RealtimeDocument | undefined {
  return (globalThis as { document?: RealtimeDocument }).document;
}

function getRealtimeWindow(): RealtimeWindow | undefined {
  return (globalThis as { window?: RealtimeWindow }).window;
}

function canKeepRealtimeConnected(): boolean {
  const currentDocument = getRealtimeDocument();
  if (!currentDocument) {
    return true;
  }

  if (currentDocument.visibilityState !== "visible") {
    return false;
  }

  if (typeof currentDocument.hasFocus === "function") {
    return currentDocument.hasFocus();
  }

  return true;
}

export function useRealtimeSync({
  enabled = true,
  foreground,
  userId,
}: RealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();
  const activityHandler = React.useRef<(() => void) | undefined>(undefined);
  const isForeground = React.useEffectEvent(
    () => foreground ?? canKeepRealtimeConnected()
  );

  const invalidateTaskQueries = React.useCallback(() => {
    // Refresh inactive cached task lists too, as with calendar lists below.
    return queryClient.refetchQueries({ queryKey: TASKS_QUERY_KEY });
  }, [queryClient]);

  const invalidateGoogleCalendarQueries = React.useCallback(
    (event: Extract<SyncEvent, { type: "google-calendar" }>) => {
      if (event.payload.calendarId === GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID) {
        // Refetch cached calendar lists even when no view currently observes them.
        return queryClient.refetchQueries({
          queryKey: GOOGLE_CALENDARS_QUERY_KEY,
        });
      }

      // A change from elsewhere (another device, Google itself) can be
      // to a series: its loaded master is stale too.
      return invalidateGoogleEventQueries(queryClient, [
        {
          accountId: event.payload.accountId,
          calendarId: event.payload.calendarId,
        },
      ]);
    },
    [queryClient]
  );

  const invalidateCriticalQueries = React.useCallback(() => {
    return Promise.all([
      invalidateTaskQueries(),
      // Include inactive calendar lists, as in invalidateGoogleCalendarQueries.
      queryClient.refetchQueries({ queryKey: GOOGLE_CALENDARS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: GOOGLE_EVENTS_QUERY_KEY }),
      queryClient.invalidateQueries({
        queryKey: GOOGLE_EVENT_MASTER_QUERY_KEY,
      }),
    ]);
  }, [invalidateTaskQueries, queryClient]);

  const handleSyncEvent = React.useCallback(
    (event: SyncEvent) => {
      switch (event.type) {
        case "google-calendar": {
          invalidateGoogleCalendarQueries(event);
          return;
        }
        case "tasks": {
          invalidateTaskQueries();
          return;
        }
        default: {
          return;
        }
      }
    },
    [invalidateGoogleCalendarQueries, invalidateTaskQueries]
  );

  React.useEffect(() => {
    if (!(enabled && userId)) {
      return;
    }

    let cancelled = false;
    let hasConnected = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    let backgroundDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pausedForBackground = !isForeground();
    let connectInFlight = false;
    let connectionController: AbortController | null = null;
    let activeIterator: AsyncIterator<SyncEvent> | null = null;

    const clearReconnectTimer = () => {
      if (!reconnectTimer) {
        return;
      }
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const clearBackgroundDisconnectTimer = () => {
      if (!backgroundDisconnectTimer) {
        return;
      }
      clearTimeout(backgroundDisconnectTimer);
      backgroundDisconnectTimer = null;
    };

    const scheduleReconnect = (immediate: boolean) => {
      clearReconnectTimer();

      if (cancelled || pausedForBackground || !isForeground()) {
        return;
      }

      if (immediate) {
        reconnectAttempts = 0;
        reconnectTimer = setTimeout(() => {
          connect();
        }, 0);
        return;
      }

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        return;
      }

      const delayMs = getReconnectDelayMs(reconnectAttempts);
      reconnectAttempts += 1;

      reconnectTimer = setTimeout(() => {
        connect();
      }, delayMs);
    };

    const clearInactivityTimer = () => {
      if (!inactivityTimer) {
        return;
      }
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    };

    const resetInactivityTimer = () => {
      clearInactivityTimer();
      if (cancelled || pausedForBackground) {
        return;
      }
      inactivityTimer = setTimeout(() => {
        // Close a silent stream so the consume loop can exit and reconnect.
        closeActiveIterator();
      }, INACTIVITY_TIMEOUT_MS);
    };

    const closeActiveIterator = async () => {
      connectionController?.abort();
      connectionController = null;
      if (!activeIterator) {
        return;
      }
      const current = activeIterator;
      activeIterator = null;
      try {
        await current.return?.();
      } catch {
        // Expo may throw when the server has already closed the ReadableStream.
      }
    };

    const pauseForBackground = async () => {
      if (cancelled) {
        return;
      }
      pausedForBackground = true;
      clearReconnectTimer();
      clearInactivityTimer();
      await closeActiveIterator();
    };

    const scheduleBackgroundDisconnect = () => {
      if (cancelled || isForeground()) {
        return;
      }

      if (backgroundDisconnectTimer) {
        return;
      }

      backgroundDisconnectTimer = setTimeout(() => {
        backgroundDisconnectTimer = null;
        if (!isForeground()) {
          pauseForBackground();
        }
      }, BACKGROUND_DISCONNECT_DELAY_MS);
    };

    const resumeFromBackground = () => {
      if (cancelled || !isForeground()) {
        return;
      }

      pausedForBackground = false;
      clearBackgroundDisconnectTimer();

      if (!(activeIterator || connectInFlight)) {
        scheduleReconnect(true);
      }
    };

    const handleConnectionActivity = () => {
      if (isForeground()) {
        resumeFromBackground();
        return;
      }

      scheduleBackgroundDisconnect();
    };

    const consumeIterator = async (iterator: AsyncIterator<SyncEvent>) => {
      let reconnectRequested = false;
      let firstEvent = true;

      while (!cancelled) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential async iterator
        const next = await iterator.next();
        if (next.done) {
          break;
        }

        // The server sends its first keepalive only after Redis subscribes.
        if (firstEvent) {
          if (hasConnected) {
            invalidateCriticalQueries();
          }
          hasConnected = true;
          firstEvent = false;
        }
        resetInactivityTimer();
        handleSyncEvent(next.value);

        if (next.value.type === "reconnect") {
          reconnectRequested = true;
          break;
        }
      }

      return reconnectRequested;
    };

    const connect = async () => {
      if (
        cancelled ||
        pausedForBackground ||
        !isForeground() ||
        connectInFlight
      ) {
        return;
      }

      connectInFlight = true;
      connectionController = new AbortController();
      let reconnectRequested = false;
      try {
        const iterator = await orpc.sync.events(undefined, {
          signal: connectionController.signal,
        });
        activeIterator = iterator;

        if (cancelled || pausedForBackground || !isForeground()) {
          return;
        }

        reconnectAttempts = 0;
        resetInactivityTimer();
        reconnectRequested = await consumeIterator(iterator);
      } catch {
        // Acquisition and stream failures use the same reconnect delay.
      } finally {
        clearInactivityTimer();
        await closeActiveIterator();
        connectInFlight = false;
        if (!cancelled) {
          scheduleReconnect(reconnectRequested);
        }
      }
    };

    if (pausedForBackground) {
      scheduleBackgroundDisconnect();
    } else {
      connect();
    }

    const realtimeWindow = getRealtimeWindow();
    const realtimeDocument = getRealtimeDocument();
    activityHandler.current = handleConnectionActivity;

    if (realtimeWindow && realtimeDocument) {
      realtimeWindow.addEventListener?.("focus", handleConnectionActivity);
      realtimeWindow.addEventListener?.("blur", handleConnectionActivity);
      realtimeDocument.addEventListener?.(
        "visibilitychange",
        handleConnectionActivity
      );
    }

    return () => {
      cancelled = true;
      activityHandler.current = undefined;
      clearReconnectTimer();
      clearInactivityTimer();
      clearBackgroundDisconnectTimer();
      if (realtimeWindow && realtimeDocument) {
        realtimeWindow.removeEventListener?.("focus", handleConnectionActivity);
        realtimeWindow.removeEventListener?.("blur", handleConnectionActivity);
        realtimeDocument.removeEventListener?.(
          "visibilitychange",
          handleConnectionActivity
        );
      }
      closeActiveIterator();
    };
  }, [enabled, handleSyncEvent, invalidateCriticalQueries, orpc, userId]);

  React.useEffect(() => {
    if (foreground !== undefined) {
      activityHandler.current?.();
    }
  }, [foreground]);
}
