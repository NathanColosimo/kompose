import { Schema } from "@effect/schema";

export class Calendar extends Schema.Class<Calendar>("Calendar")({
  id: Schema.String,
  summary: Schema.String,
  description: Schema.String,
  timeZone: Schema.String,
  primary: Schema.Boolean,
  accessRole: Schema.String,
}) {}

// Input for creating a calendar (ID is assigned by Google)
export const CreateCalendarInput = Schema.Struct(Calendar.fields).pipe(
  Schema.omit("id", "primary", "accessRole") // primary/accessRole are read-only system fields
);

export class Event extends Schema.Class<Event>("Event")({
  id: Schema.String,
  summary: Schema.String,
  description: Schema.String,
  start: Schema.Struct({
    dateTime: Schema.DateTimeUtc,
    date: Schema.optional(Schema.String),
  }),
  end: Schema.Struct({
    dateTime: Schema.DateTimeUtc,
    date: Schema.optional(Schema.String),
  }),
}) {}

// Input for creating an event (ID is assigned by Google)
export const CreateEventInput = Schema.Struct(Event.fields).pipe(
  Schema.omit("id")
);
