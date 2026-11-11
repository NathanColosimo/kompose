import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import { getGoogleEventEditBlockReason } from "@kompose/google-cal/schema";
import { implement } from "@orpc/server";
import { Effect, Option } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import {
  getLinkedAccessToken,
  getLinkedAccount,
  type LinkedAccount,
} from "../../lib/linked-account";
import { globalRateLimit } from "../../ratelimit";
import { publishToUser } from "../../realtime/sync";
import { GoogleCalendarCacheService } from "./cache";
import { googleCalContract } from "./contract";
import { NonEditableGoogleEventError } from "./errors";
import { invalidateGoogleCalendarEvents } from "./refresh";

const getGoogleCalendar = Effect.fn("getGoogleCalendar")(function* (
  link: LinkedAccount
) {
  const accessToken = yield* getLinkedAccessToken(link);
  return makeGoogleCalendarService(accessToken);
});

export const os = implement(googleCalContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

function includesSearchText(value: string | undefined, query: string): boolean {
  return value?.toLowerCase().includes(query) ?? false;
}

function filterEventsBySearch<
  T extends { summary?: string; description?: string; location?: string },
>(events: T[], query: string): T[] {
  return events.filter(
    (event) =>
      includesSearchText(event.summary, query) ||
      includesSearchText(event.description, query) ||
      includesSearchText(event.location, query)
  );
}

const ensureGoogleEventEditable = (event: {
  id: string;
  description?: string;
  eventType?: string;
  locked?: boolean;
}) => {
  const blockedReason = getGoogleEventEditBlockReason(event);
  if (!blockedReason) {
    return Effect.void;
  }

  return Effect.fail(
    new NonEditableGoogleEventError({
      eventId: event.id,
      eventType: event.eventType,
      message: blockedReason,
    })
  );
};

export const googleCalRouter = os.router({
  calendars: {
    create: os.calendars.create.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(link);

      const calendar = yield* google.createCalendar(input.calendar);

      yield* cache.invalidateCalendars(context.user.id, link.id);

      yield* publishToUser(context.user.id, {
        payload: { accountId: input.accountId, calendarId: calendar.id },
        type: "google-calendar",
      });

      return calendar;
    }),

    delete: os.calendars.delete.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(link);

      yield* google.deleteCalendar(input.calendarId);

      yield* Effect.all(
        [
          cache.invalidateCalendars(context.user.id, link.id),
          cache.invalidateAllEvents(context.user.id, link.id, input.calendarId),
        ],
        { concurrency: "unbounded", discard: true }
      );

      yield* publishToUser(context.user.id, {
        payload: { accountId: input.accountId, calendarId: input.calendarId },
        type: "google-calendar",
      });

      return null;
    }),

    get: os.calendars.get.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;

      const cached = yield* cache.getCachedCalendar(
        context.user.id,
        link.id,
        input.calendarId
      );
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const calendar = yield* google.getCalendar(input.calendarId);

      yield* cache.setCachedCalendar(
        context.user.id,
        link.id,
        input.calendarId,
        calendar
      );

      return calendar;
    }),
    list: os.calendars.list.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;

      const cached = yield* cache.getCachedCalendars(context.user.id, link.id);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const calendars = yield* google.listCalendars();

      yield* cache.setCachedCalendars(context.user.id, link.id, calendars);

      return calendars;
    }),

    update: os.calendars.update.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(link);

      const calendar = yield* google.updateCalendar(
        input.calendarId,
        input.calendar
      );

      yield* cache.invalidateCalendars(context.user.id, link.id);

      yield* publishToUser(context.user.id, {
        payload: { accountId: input.accountId, calendarId: input.calendarId },
        type: "google-calendar",
      });

      return calendar;
    }),
  },

  colors: {
    list: os.colors.list.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;

      const cached = yield* cache.getCachedColors(context.user.id, link.id);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const colors = yield* google.listColors();

      yield* cache.setCachedColors(context.user.id, link.id, colors);

      return colors;
    }),
  },

  events: {
    create: os.events.create.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const google = yield* getGoogleCalendar(link);
      return yield* google.createEvent(input.calendarId, input.event).pipe(
        Effect.ensuring(
          invalidateGoogleCalendarEvents({
            linkedAccountId: link.id,
            accountId: input.accountId,
            calendarIds: [input.calendarId],
            userId: context.user.id,
          })
        )
      );
    }),

    delete: os.events.delete.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const google = yield* getGoogleCalendar(link);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      yield* google
        .deleteEvent(input.calendarId, input.eventId, input.scope)
        .pipe(
          Effect.ensuring(
            invalidateGoogleCalendarEvents({
              linkedAccountId: link.id,
              accountId: input.accountId,
              calendarIds: [input.calendarId],
              recurringEventId: currentEvent.recurringEventId,
              eventId: input.eventId,
              userId: context.user.id,
            })
          )
        );

      return null;
    }),

    get: os.events.get.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;

      const cached = yield* cache.getCachedEvent(
        context.user.id,
        link.id,
        input.calendarId,
        input.eventId
      );
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const event = yield* google.getEvent(input.calendarId, input.eventId);

      yield* cache.setCachedEvent(
        context.user.id,
        link.id,
        input.calendarId,
        input.eventId,
        event
      );

      return event;
    }),
    list: os.events.list.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const searchQuery = input.params.query?.toLowerCase();

      const cache = yield* GoogleCalendarCacheService;

      const cached = yield* cache.getCachedEvents(
        context.user.id,
        link.id,
        input.calendarId,
        input.params.timeMin,
        input.params.timeMax
      );
      if (Option.isSome(cached)) {
        if (!searchQuery) {
          return cached.value;
        }
        return filterEventsBySearch(cached.value, searchQuery);
      }

      const google = yield* getGoogleCalendar(link);
      const events = yield* google.listEvents(
        input.calendarId,
        input.params.timeMin,
        input.params.timeMax
      );

      yield* cache.setCachedEvents(
        context.user.id,
        link.id,
        input.calendarId,
        input.params.timeMin,
        input.params.timeMax,
        events
      );

      if (!searchQuery) {
        return events;
      }
      return filterEventsBySearch(events, searchQuery);
    }),

    move: os.events.move.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const google = yield* getGoogleCalendar(link);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      const event = yield* google
        .moveEvent(
          input.calendarId,
          input.eventId,
          input.destinationCalendarId,
          input.scope
        )
        .pipe(
          Effect.ensuring(
            invalidateGoogleCalendarEvents({
              linkedAccountId: link.id,
              accountId: input.accountId,
              calendarIds: [input.calendarId, input.destinationCalendarId],
              recurringEventId: currentEvent.recurringEventId,
              eventId: input.eventId,
              userId: context.user.id,
            })
          )
        );

      return event;
    }),

    update: os.events.update.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const google = yield* getGoogleCalendar(link);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      const event = yield* google
        .updateEvent(
          input.calendarId,
          input.eventId,
          input.event,
          input.scope,
          currentEvent
        )
        .pipe(
          Effect.ensuring(
            invalidateGoogleCalendarEvents({
              linkedAccountId: link.id,
              accountId: input.accountId,
              calendarIds: [input.calendarId],
              recurringEventId: currentEvent.recurringEventId,
              eventId: input.eventId,
              userId: context.user.id,
            })
          )
        );

      return event;
    }),
  },
});
