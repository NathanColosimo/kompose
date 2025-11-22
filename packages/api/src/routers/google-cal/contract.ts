import {
  Calendar,
  CreateCalendarInput,
  CreateEventInput,
  Event,
} from "@kompose/google-cal/schema";
import { oc } from "@orpc/contract";
import { Schema } from "effect";

// Helper to convert Effect Schema to Standard Schema V1
// Note: Schema.standardSchemaV1 takes a Schema and returns a StandardSchemaV1 compliant object.
// Nested Schemas (like inside Array) do NOT need to be wrapped; only the top-level one passed to 'oc.output' needs to be compliant.

export const listCalendars = oc
  .input(Schema.standardSchemaV1(Schema.Struct({ accountId: Schema.String })))
  .output(Schema.standardSchemaV1(Schema.Array(Calendar)));

export const getCalendar = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({ accountId: Schema.String, calendarId: Schema.String })
    )
  )
  .output(Schema.standardSchemaV1(Calendar));

export const createCalendar = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({ accountId: Schema.String, calendar: CreateCalendarInput })
    )
  )
  .output(Schema.standardSchemaV1(Calendar));

export const updateCalendar = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        accountId: Schema.String,
        calendarId: Schema.String,
        calendar: CreateCalendarInput,
      })
    )
  )
  .output(Schema.standardSchemaV1(Calendar));

export const deleteCalendar = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({ accountId: Schema.String, calendarId: Schema.String })
    )
  )
  .output(Schema.standardSchemaV1(Schema.Void));

// --- Events ---

export const listEvents = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({ accountId: Schema.String, calendarId: Schema.String })
    )
  )
  .output(Schema.standardSchemaV1(Schema.Array(Event)));

export const getEvent = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        accountId: Schema.String,
        calendarId: Schema.String,
        eventId: Schema.String,
      })
    )
  )
  .output(Schema.standardSchemaV1(Event));

export const createEvent = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        accountId: Schema.String,
        calendarId: Schema.String,
        event: CreateEventInput,
      })
    )
  )
  .output(Schema.standardSchemaV1(Event));

export const updateEvent = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        accountId: Schema.String,
        calendarId: Schema.String,
        eventId: Schema.String,
        event: CreateEventInput,
      })
    )
  )
  .output(Schema.standardSchemaV1(Event));

export const deleteEvent = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        accountId: Schema.String,
        calendarId: Schema.String,
        eventId: Schema.String,
      })
    )
  )
  .output(Schema.standardSchemaV1(Schema.Void));

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
