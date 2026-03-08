import type { DashboardBootstrapOutput } from "@kompose/api/routers/bootstrap/contract";
import { taskSelectCodec } from "@kompose/api/routers/task/contract";
import type { QueryClient } from "@tanstack/react-query";
import { TAGS_QUERY_KEY } from "./atoms/tags";
import { TASKS_QUERY_KEY } from "./atoms/tasks";
import {
  GOOGLE_ACCOUNTS_QUERY_KEY,
  type GoogleEventsWindow,
  getGoogleAccountInfoQueryKey,
  getGoogleCalendarsQueryKey,
  getGoogleColorsQueryKey,
  getGoogleEventsQueryKey,
} from "./google-calendar-query-keys";

export const DASHBOARD_BOOTSTRAP_STATUS_QUERY_KEY = [
  "dashboard-bootstrap",
  "status",
] as const;

function seedIfMissing<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  value: T
) {
  if (queryClient.getQueryData(queryKey) !== undefined) {
    return;
  }

  queryClient.setQueryData(queryKey, value);
}

/**
 * Seed the existing granular caches from the bootstrap payload so every
 * existing hook keeps working with its current query key and invalidation path.
 */
export function seedDashboardBootstrapCache(
  queryClient: QueryClient,
  payload: DashboardBootstrapOutput,
  window: GoogleEventsWindow
) {
  seedIfMissing(queryClient, GOOGLE_ACCOUNTS_QUERY_KEY, payload.googleAccounts);

  for (const profile of payload.googleAccountProfiles) {
    seedIfMissing(
      queryClient,
      getGoogleAccountInfoQueryKey(profile.accountId),
      profile
    );
  }

  for (const accountCalendars of payload.googleCalendars) {
    seedIfMissing(
      queryClient,
      getGoogleCalendarsQueryKey(accountCalendars.accountId),
      accountCalendars.calendars.map((calendar) => ({
        accountId: accountCalendars.accountId,
        calendar,
      }))
    );
  }

  for (const accountColors of payload.googleColors) {
    seedIfMissing(
      queryClient,
      getGoogleColorsQueryKey(accountColors.accountId),
      accountColors.colors
    );
  }

  for (const accountEvents of payload.googleEvents) {
    seedIfMissing(
      queryClient,
      getGoogleEventsQueryKey(
        {
          accountId: accountEvents.accountId,
          calendarId: accountEvents.calendarId,
        },
        window
      ),
      accountEvents.events
    );
  }

  seedIfMissing(
    queryClient,
    TASKS_QUERY_KEY,
    payload.tasks.map((task) => taskSelectCodec.parse(task))
  );
  seedIfMissing(queryClient, TAGS_QUERY_KEY, payload.tags);
}
