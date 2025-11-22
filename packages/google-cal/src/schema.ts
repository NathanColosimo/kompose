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
  Schema.omit("id", "primary", "accessRole")
);

export class Event extends Schema.Class<Event>("Event")({
  id: Schema.String,
  summary: Schema.String,
  description: Schema.optional(Schema.String), // Description can be empty/undefined
  location: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String), // "confirmed", "tentative", "cancelled"
  htmlLink: Schema.optional(Schema.String), // Link to view in Google Calendar
  colorId: Schema.optional(Schema.String),

  start: Schema.Struct({
    dateTime: Schema.optional(Schema.DateTimeUtc), // Optional because all-day events use 'date'
    date: Schema.optional(Schema.String),
    timeZone: Schema.optional(Schema.String),
  }),
  end: Schema.Struct({
    dateTime: Schema.optional(Schema.DateTimeUtc),
    date: Schema.optional(Schema.String),
    timeZone: Schema.optional(Schema.String),
  }),

  recurrence: Schema.optional(Schema.Array(Schema.String)), // Array of RRULE strings
  recurringEventId: Schema.optional(Schema.String), // If this is an instance of a recurring event

  organizer: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      displayName: Schema.optional(Schema.String),
      self: Schema.optional(Schema.Boolean),
    })
  ),

  attendees: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        email: Schema.optional(Schema.String),
        displayName: Schema.optional(Schema.String),
        organizer: Schema.optional(Schema.Boolean),
        self: Schema.optional(Schema.Boolean),
        resource: Schema.optional(Schema.Boolean),
        optional: Schema.optional(Schema.Boolean),
        responseStatus: Schema.optional(Schema.String), // "needsAction", "declined", "tentative", "accepted"
        comment: Schema.optional(Schema.String),
      })
    )
  ),

  conferenceData: Schema.optional(
    Schema.Struct({
      entryPoints: Schema.optional(
        Schema.Array(
          Schema.Struct({
            entryPointType: Schema.optional(Schema.String), // "video", "phone", "more", "sip"
            uri: Schema.optional(Schema.String),
            label: Schema.optional(Schema.String),
            pin: Schema.optional(Schema.String),
            accessCode: Schema.optional(Schema.String),
            meetingCode: Schema.optional(Schema.String),
            passcode: Schema.optional(Schema.String),
            password: Schema.optional(Schema.String),
          })
        )
      ),
      conferenceSolution: Schema.optional(
        Schema.Struct({
          key: Schema.optional(
            Schema.Struct({ type: Schema.optional(Schema.String) })
          ),
          name: Schema.optional(Schema.String),
          iconUri: Schema.optional(Schema.String),
        })
      ),
      conferenceId: Schema.optional(Schema.String),
    })
  ),
}) {}

// Input for creating an event (ID is assigned by Google)
// We generally want to allow setting most of these fields, but omit system-managed ones like 'htmlLink' or 'organizer.self'
export const CreateEventInput = Schema.Struct(Event.fields).pipe(
  Schema.omit("id", "htmlLink", "organizer") // Organizer is set by auth context usually
);
