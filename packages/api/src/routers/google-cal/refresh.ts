import { Effect } from "effect";
import { publishToUser } from "../../realtime/sync";
import { GoogleCalendarCacheService } from "./cache";

/** Clears caches and notifies open windows after an event write, even if it failed. */
export const invalidateGoogleCalendarEvents = Effect.fn(
  "invalidateGoogleCalendarEvents"
)(function* (params: {
  accountId: string;
  /** The event's calendar first, then any other the write touched. */
  calendarIds: [string, ...string[]];
  eventId?: string;
  recurringEventId?: string;
  userId: string;
}) {
  const { accountId, calendarIds, userId } = params;
  const cache = yield* GoogleCalendarCacheService;
  const eventIds = [params.eventId, params.recurringEventId].filter(
    (id) => id !== undefined
  );
  yield* Effect.all(
    [
      ...calendarIds.map((calendarId) =>
        cache.invalidateEventLists(userId, accountId, calendarId)
      ),
      ...eventIds.map((eventId) =>
        cache.invalidateEvent(userId, accountId, calendarIds[0], eventId)
      ),
    ],
    { concurrency: "unbounded", discard: true }
  );
  yield* Effect.all(
    calendarIds.map((calendarId) =>
      publishToUser(userId, {
        payload: { accountId, calendarId },
        type: "google-calendar",
      })
    ),
    { concurrency: "unbounded", discard: true }
  );
});
