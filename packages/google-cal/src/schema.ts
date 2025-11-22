import { Schema } from "effect";

export const Calendar = Schema.Struct({
  id: Schema.String,
  summary: Schema.String,
  description: Schema.String,
  timeZone: Schema.String,
  primary: Schema.Boolean,
  accessRole: Schema.String,
});

// Input for creating a calendar (ID is assigned by Google)
export const CreateCalendarInput = Schema.Struct(Calendar.fields).pipe(
  Schema.omit("id", "primary", "accessRole")
);

export const Event = Schema.Struct({
  id: Schema.String,
  summary: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  htmlLink: Schema.optional(Schema.String),
  colorId: Schema.optional(Schema.String),

  start: Schema.Struct({
    dateTime: Schema.optional(Schema.DateTimeUtc), // Decodes ISO string -> DateTime.Utc
    date: Schema.optional(Schema.String),
    timeZone: Schema.optional(Schema.String),
  }),
  end: Schema.Struct({
    dateTime: Schema.optional(Schema.DateTimeUtc), // Decodes ISO string -> DateTime.Utc
    date: Schema.optional(Schema.String),
    timeZone: Schema.optional(Schema.String),
  }),

  recurrence: Schema.optional(Schema.Array(Schema.String)),
  recurringEventId: Schema.optional(Schema.String),

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
        responseStatus: Schema.optional(Schema.String),
        comment: Schema.optional(Schema.String),
      })
    )
  ),

  conferenceData: Schema.optional(
    Schema.Struct({
      entryPoints: Schema.optional(
        Schema.Array(
          Schema.Struct({
            entryPointType: Schema.optional(Schema.String),
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
});

// Input for creating an event (ID is assigned by Google)
export const CreateEventInput = Event.pipe(
  Schema.omit("id", "htmlLink", "organizer")
);
