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
import { RealtimeSyncSupervisor } from "../realtime-sync-supervisor";

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
  const supervisorRef = React.useRef<RealtimeSyncSupervisor | null>(null);
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

      return queryClient.invalidateQueries({
        queryKey: getGoogleEventsByCalendarQueryKey({
          accountId: event.payload.accountId,
          calendarId: event.payload.calendarId,
        }),
      });
    },
    [queryClient]
  );

  const invalidateCriticalQueries = React.useCallback(() => {
    return Promise.all([
      invalidateTaskQueries(),
      // Include inactive calendar lists, as in invalidateGoogleCalendarQueries.
      queryClient.refetchQueries({ queryKey: GOOGLE_CALENDARS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: GOOGLE_EVENTS_QUERY_KEY }),
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
        case "reconnect": {
          return;
        }
        case "keepalive": {
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

    const supervisor = new RealtimeSyncSupervisor({
      connect: (signal) => orpc.sync.events(undefined, { signal }),
      onEvent: handleSyncEvent,
      onResubscribe: invalidateCriticalQueries,
    });
    supervisorRef.current = supervisor;
    supervisor.start(isForeground());
    const handleConnectionActivity = () => {
      supervisor.setForeground(isForeground());
    };

    const realtimeWindow = getRealtimeWindow();
    const realtimeDocument = getRealtimeDocument();

    if (realtimeWindow && realtimeDocument) {
      realtimeWindow.addEventListener?.("focus", handleConnectionActivity);
      realtimeWindow.addEventListener?.("blur", handleConnectionActivity);
      realtimeDocument.addEventListener?.(
        "visibilitychange",
        handleConnectionActivity
      );
    }

    return () => {
      supervisor.stop();
      supervisorRef.current = null;
      if (realtimeWindow && realtimeDocument) {
        realtimeWindow.removeEventListener?.("focus", handleConnectionActivity);
        realtimeWindow.removeEventListener?.("blur", handleConnectionActivity);
        realtimeDocument.removeEventListener?.(
          "visibilitychange",
          handleConnectionActivity
        );
      }
    };
  }, [enabled, handleSyncEvent, invalidateCriticalQueries, orpc, userId]);

  React.useEffect(() => {
    supervisorRef.current?.setForeground(
      foreground ?? canKeepRealtimeConnected()
    );
  }, [foreground]);
}
