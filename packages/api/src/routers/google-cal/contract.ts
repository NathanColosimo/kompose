import {
  CalendarSchema,
  ColorsSchema,
  CreateCalendarInputSchema,
  CreateEventInputSchema,
  EventSchema,
  RecurrenceScopeSchema,
} from "@kompose/google-cal/schema";
import { oc } from "@orpc/contract";
import { z } from "zod";

// --- Calendars ---

export const ListCalendarsInputSchema = z.object({
  accountId: z.string(),
});
export type ListCalendarsInput = z.infer<typeof ListCalendarsInputSchema>;

/**
 * List all calendars for a given account.
 */
export const listCalendars = oc
  .input(ListCalendarsInputSchema)
  .output(z.array(CalendarSchema));

/**
 * Get a calendar by ID for a given account.
 */
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

export const ListEventsInputSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  timeMin: z.iso.datetime({ offset: true }),
  timeMax: z.iso.datetime({ offset: true }),
});
export type ListEventsInput = z.infer<typeof ListEventsInputSchema>;

export const listEvents = oc
  .input(ListEventsInputSchema)
  .output(z.array(EventSchema));

export const GetEventInputSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  eventId: z.string(),
});
export type GetEventInput = z.infer<typeof GetEventInputSchema>;

export const getEvent = oc.input(GetEventInputSchema).output(EventSchema);

export const CreateEventInputSchemaFull = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  event: CreateEventInputSchema,
});
export type CreateEventInput = z.infer<typeof CreateEventInputSchemaFull>;

export const createEvent = oc
  .input(CreateEventInputSchemaFull)
  .output(EventSchema);

export const UpdateEventInputSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  eventId: z.string(),
  event: CreateEventInputSchema,
  scope: RecurrenceScopeSchema,
});
export type UpdateEventInput = z.infer<typeof UpdateEventInputSchema>;

export const updateEvent = oc.input(UpdateEventInputSchema).output(EventSchema);

export const MoveEventInputSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  eventId: z.string(),
  destinationCalendarId: z.string(),
  scope: RecurrenceScopeSchema,
});
export type MoveEventInput = z.infer<typeof MoveEventInputSchema>;

export const moveEvent = oc.input(MoveEventInputSchema).output(EventSchema);

export const DeleteEventInputSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  eventId: z.string(),
  scope: RecurrenceScopeSchema,
});
export type DeleteEventInput = z.infer<typeof DeleteEventInputSchema>;

export const deleteEvent = oc.input(DeleteEventInputSchema).output(z.void());

// --- Colors ---

export const listColors = oc
  .input(z.object({ accountId: z.string() }))
  .output(ColorsSchema);

export const googleCalContract = {
  calendars: {
    list: listCalendars,
    get: getCalendar,
    create: createCalendar,
    update: updateCalendar,
    delete: deleteCalendar,
  },
  colors: {
    list: listColors,
  },
  events: {
    list: listEvents,
    get: getEvent,
    create: createEvent,
    update: updateEvent,
    move: moveEvent,
    delete: deleteEvent,
  },
};
