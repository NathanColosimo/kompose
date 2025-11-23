import {
  CalendarSchema,
  CreateCalendarInputSchema,
  CreateEventInputSchema,
  EventSchema,
} from "@kompose/google-cal/schema";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const listCalendars = oc
  .input(z.object({ accountId: z.string() }))
  .output(z.array(CalendarSchema));

export const getCalendar = oc
  .input(z.object({ accountId: z.string(), calendarId: z.string() }))
  .output(CalendarSchema);

export const createCalendar = oc
  .input(
    z.object({ accountId: z.string(), calendar: CreateCalendarInputSchema })
  )
  .output(CalendarSchema);

export const updateCalendar = oc
  .input(
    z.object({
      accountId: z.string(),
      calendarId: z.string(),
      calendar: CreateCalendarInputSchema,
    })
  )
  .output(CalendarSchema);

export const deleteCalendar = oc
  .input(z.object({ accountId: z.string(), calendarId: z.string() }))
  .output(z.void());

// --- Events ---

export const listEvents = oc
  .input(
    z.object({
      accountId: z.string(),
      calendarId: z.string(),
      timeMin: z.string(),
      timeMax: z.string(),
    })
  )
  .output(z.array(EventSchema));

export const getEvent = oc
  .input(
    z.object({
      accountId: z.string(),
      calendarId: z.string(),
      eventId: z.string(),
    })
  )
  .output(EventSchema);

export const createEvent = oc
  .input(
    z.object({
      accountId: z.string(),
      calendarId: z.string(),
      event: CreateEventInputSchema,
    })
  )
  .output(EventSchema);

export const updateEvent = oc
  .input(
    z.object({
      accountId: z.string(),
      calendarId: z.string(),
      eventId: z.string(),
      event: CreateEventInputSchema,
    })
  )
  .output(EventSchema);

export const deleteEvent = oc
  .input(
    z.object({
      accountId: z.string(),
      calendarId: z.string(),
      eventId: z.string(),
      event: CreateEventInputSchema,
    })
  )
  .output(z.void());

export const googleCalContract = {
  calendars: {
    list: listCalendars,
    get: getCalendar,
    create: createCalendar,
    update: updateCalendar,
    delete: deleteCalendar,
  },
  events: {
    list: listEvents,
    get: getEvent,
    create: createEvent,
    update: updateEvent,
    delete: deleteEvent,
  },
};
