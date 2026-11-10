import { Effect } from "effect";
import { publishToUser } from "../../realtime/sync";
import { GoogleCalendarCacheService } from "./cache";

/** Tells the user's open windows that a calendar's events changed. */
export function publishGoogleCalendarEvent(
  userId: string,
  accountId: string,
  calendarId: string
) {
  return publishToUser(userId, {
    payload: { accountId, calendarId },
    type: "google-calendar",
  });
}

/**
 * Runs `write`, an update, move or delete through `eventId`, then clears
 * what it may have changed (the calendars' event lists, the event, and for
 * an occurrence its series, which a series write rewrites or ends) and
 * tells the user's windows. The clearing runs whether the write succeeded
 * or not: a series write can change Google and still fail part way.
 */
export const writeAndRefresh = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  params: {
    accountId: string;
    /** The event's calendar first, then any other the write touched. */
    calendarIds: [string, ...string[]];
    eventId: string;
    recurringEventId?: string;
    userId: string;
  }
) =>
  write.pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const { accountId, calendarIds, userId } = params;
        const cache = yield* GoogleCalendarCacheService;
        const eventIds = params.recurringEventId
          ? [params.eventId, params.recurringEventId]
          : [params.eventId];
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
            publishGoogleCalendarEvent(userId, accountId, calendarId)
          ),
          { concurrency: "unbounded", discard: true }
        );
      }).pipe(Effect.withSpan("refreshAfterWrite"))
    )
  );
