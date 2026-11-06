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

function publishGoogleCalendarEvent(
  userId: string,
  accountId: string,
  calendarId: string
) {
  return publishToUser(userId, {
    payload: { accountId, calendarId },
    type: "google-calendar",
  });
}

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

      yield* cache.invalidateCalendars(link);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        calendar.id
      );

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
          cache.invalidateCalendars(link),
          cache.invalidateEvents(link, input.calendarId),
        ],
        { concurrency: "unbounded", discard: true }
      );

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return null;
    }),

    get: os.calendars.get.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;

      const entry = yield* cache.calendar(link, input.calendarId);
      const cached = yield* entry.get;
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const calendar = yield* google.getCalendar(input.calendarId);

      yield* entry.set(calendar);

      return calendar;
    }),
    list: os.calendars.list.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;

      const entry = yield* cache.calendars(link);
      const cached = yield* entry.get;
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const calendars = yield* google.listCalendars();

      yield* entry.set(calendars);

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

      yield* cache.invalidateCalendars(link);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

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

      const entry = yield* cache.colors(link);
      const cached = yield* entry.get;
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const colors = yield* google.listColors();

      yield* entry.set(colors);

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
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(link);

      const event = yield* google.createEvent(input.calendarId, input.event);

      yield* cache.invalidateEvents(link, input.calendarId);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return event;
    }),

    delete: os.events.delete.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(link);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      yield* google.deleteEvent(input.calendarId, input.eventId, input.scope);

      yield* cache.invalidateEvents(link, input.calendarId);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
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

      const entry = yield* cache.event(link, input);
      const cached = yield* entry.get;
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(link);
      const event = yield* google.getEvent(input.calendarId, input.eventId);

      yield* entry.set(event);

      return event;
    }),
    list: os.events.list.effect(function* ({ input, context }) {
      const searchQuery = input.params.query?.toLowerCase();

      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;

      const entry = yield* cache.events(link, {
        calendarId: input.calendarId,
        ...input.params,
      });
      const cached = yield* entry.get;
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

      yield* entry.set(events);

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
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(link);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      const event = yield* google.moveEvent(
        input.calendarId,
        input.eventId,
        input.destinationCalendarId,
        input.scope
      );

      yield* Effect.all(
        [
          cache.invalidateEvents(link, input.calendarId),
          cache.invalidateEvents(link, input.destinationCalendarId),
        ],
        { concurrency: "unbounded", discard: true }
      );

      yield* Effect.all(
        [
          publishGoogleCalendarEvent(
            context.user.id,
            input.accountId,
            input.calendarId
          ),
          publishGoogleCalendarEvent(
            context.user.id,
            input.accountId,
            input.destinationCalendarId
          ),
        ],
        { concurrency: "unbounded", discard: true }
      );

      return event;
    }),

    update: os.events.update.effect(function* ({ input, context }) {
      const link = yield* getLinkedAccount({
        accountId: input.accountId,
        providerId: "google",
        userId: context.user.id,
      });
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(link);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      const event = yield* google.updateEvent(
        input.calendarId,
        input.eventId,
        input.event,
        input.scope,
        currentEvent
      );

      yield* cache.invalidateEvents(link, input.calendarId);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return event;
    }),
  },
});
