"use client";

import type { DashboardBootstrapInput } from "@kompose/api/routers/bootstrap/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import {
  type VisibleCalendars,
  visibleCalendarsAtom,
} from "../atoms/visible-calendars";
import {
  DASHBOARD_BOOTSTRAP_STATUS_QUERY_KEY,
  seedDashboardBootstrapCache,
} from "../bootstrap-cache";
import { hasSessionAtom, useStateConfig } from "../config";

function getDashboardBootstrapQueryKey(window: DashboardBootstrapInput) {
  return [
    "dashboard-bootstrap",
    "dashboard",
    window.timeMin,
    window.timeMax,
  ] as const;
}

/**
 * Run the bounded first-load bootstrap once per signed-in cache lifecycle.
 * After seeding the granular caches, screens fall back to the existing hooks.
 */
export function useDashboardBootstrap({
  enabled = true,
  visibleCalendarsOverride,
  window,
}: {
  enabled?: boolean;
  visibleCalendarsOverride?: VisibleCalendars;
  window: DashboardBootstrapInput;
}) {
  const queryClient = useQueryClient();
  const hasSession = useAtomValue(hasSessionAtom);
  const storedVisibleCalendars = useAtomValue(visibleCalendarsAtom);
  const { orpc } = useStateConfig();
  const bootstrapComplete =
    queryClient.getQueryData<boolean>(DASHBOARD_BOOTSTRAP_STATUS_QUERY_KEY) ===
    true;
  const visibleCalendars = visibleCalendarsOverride ?? storedVisibleCalendars;

  return useQuery({
    queryKey: getDashboardBootstrapQueryKey(window),
    enabled: enabled && hasSession && !bootstrapComplete,
    gcTime: 0,
    queryFn: async () => {
      const payload = await orpc.bootstrap.dashboard({
        ...window,
        visibleCalendars,
      });
      seedDashboardBootstrapCache(queryClient, payload, window);
      queryClient.setQueryData(DASHBOARD_BOOTSTRAP_STATUS_QUERY_KEY, true);
      return true;
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    throwOnError: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}
