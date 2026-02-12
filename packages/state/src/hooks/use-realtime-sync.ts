"use client";

import { GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID } from "@kompose/api/realtime/events";
import type { SyncEvent } from "@kompose/api/routers/sync/contract";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import { TASKS_QUERY_KEY } from "../atoms/tasks";
import { useStateConfig } from "../config";
import {
  GOOGLE_CALENDARS_QUERY_KEY,
  GOOGLE_EVENTS_QUERY_KEY,
  getGoogleEventsByCalendarQueryKey,
} from "../google-calendar-query-keys";
import {
  AI_CHAT_QUERY_ROOT,
  AI_CHAT_SESSIONS_QUERY_KEY,
  getAiChatMessagesQueryKey,
} from "./use-ai-chat";

const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY_MS = 30_000;

export interface RealtimeSyncOptions {
  enabled?: boolean;
  userId?: string;
}

function getReconnectDelayMs(attempt: number): number {
  return Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt),
    MAX_RECONNECT_DELAY_MS
  );
}

export function useRealtimeSync({
  enabled = true,
  userId,
}: RealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();

  const invalidateTaskQueries = React.useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
  }, [queryClient]);

  const invalidateGoogleCalendarQueries = React.useCallback(
    (event: Extract<SyncEvent, { type: "google-calendar" }>) => {
      if (event.payload.calendarId === GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID) {
        // Calendars use atomWithQuery (Jotai), which doesn't auto-refetch on
        // invalidateQueries (unlike useQueries hooks). refetchQueries forces an
        // immediate refetch so the atom observer sees the new cache data.
        return queryClient.refetchQueries({
          queryKey: GOOGLE_CALENDARS_QUERY_KEY,
        });
      }

      return queryClient.invalidateQueries({
        queryKey: getGoogleEventsByCalendarQueryKey({
          accountId: event.payload.accountId,
          calendarId: event.payload.calendarId,
        }),
      });
    },
    [queryClient]
  );

  const invalidateAiChatQueries = React.useCallback(
    (event: Extract<SyncEvent, { type: "ai-chat" }>) => {
      return Promise.all([
        // Force immediate session refetch so activeStreamId updates quickly.
        queryClient.refetchQueries({ queryKey: AI_CHAT_SESSIONS_QUERY_KEY }),
        // Refetch the affected message thread for faster cross-device updates.
        queryClient.refetchQueries({
          queryKey: getAiChatMessagesQueryKey(event.payload.sessionId),
        }),
      ]);
    },
    [queryClient]
  );

  const invalidateCriticalQueries = React.useCallback(() => {
    return Promise.all([
      invalidateTaskQueries(),
      // Calendars use atomWithQuery — need refetch, not just invalidate
      queryClient.refetchQueries({ queryKey: GOOGLE_CALENDARS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: GOOGLE_EVENTS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: AI_CHAT_QUERY_ROOT }),
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
        case "ai-chat": {
          invalidateAiChatQueries(event);
          return;
        }
        case "reconnect": {
          invalidateCriticalQueries();
          return;
        }
        default: {
          return;
        }
      }
    },
    [
      invalidateCriticalQueries,
      invalidateAiChatQueries,
      invalidateGoogleCalendarQueries,
      invalidateTaskQueries,
    ]
  );

  React.useEffect(() => {
    if (!(enabled && userId)) {
      return;
    }

    let cancelled = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let activeIterator: AsyncIterator<SyncEvent> | null = null;

    const clearReconnectTimer = () => {
      if (!reconnectTimer) {
        return;
      }
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const scheduleReconnect = (immediate: boolean) => {
      clearReconnectTimer();

      if (cancelled) {
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

    const closeActiveIterator = async () => {
      if (!activeIterator) {
        return;
      }
      const current = activeIterator;
      activeIterator = null;
      // Expo's fetch ReadableStream may already be closed when the server
      // ends the SSE connection, causing a "stream is not in a state that
      // permits close" error. This is safe to ignore during cleanup.
      try {
        await current.return?.();
      } catch {
        // Expected on mobile when the stream is already closed.
      }
    };

    const consumeIterator = async (iterator: AsyncIterator<SyncEvent>) => {
      let reconnectRequested = false;

      while (!cancelled) {
        const next = await iterator.next();
        if (next.done) {
          break;
        }

        handleSyncEvent(next.value);

        if (next.value.type === "reconnect") {
          reconnectRequested = true;
          break;
        }
      }

      return reconnectRequested;
    };

    const connect = async () => {
      if (cancelled) {
        return;
      }

      try {
        const iterator = await orpc.sync.events();
        activeIterator = iterator;

        if (cancelled) {
          await closeActiveIterator();
          return;
        }

        reconnectAttempts = 0;
        await invalidateCriticalQueries();
        const reconnectRequested = await consumeIterator(iterator);

        await closeActiveIterator();

        if (!cancelled) {
          scheduleReconnect(reconnectRequested);
        }
      } catch {
        if (!cancelled) {
          scheduleReconnect(false);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      closeActiveIterator();
    };
  }, [enabled, handleSyncEvent, invalidateCriticalQueries, orpc, userId]);
}
