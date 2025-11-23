import { z } from "zod";

export const CalendarSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  timeZone: z.string().optional(),
  primary: z.boolean().optional(),
  accessRole: z.string().optional(),
});

export type Calendar = z.infer<typeof CalendarSchema>;

// Input for creating a calendar (ID is assigned by Google)
export const CreateCalendarInputSchema = CalendarSchema.omit({
  id: true,
  primary: true,
  accessRole: true,
});

export type CreateCalendar = z.infer<typeof CreateCalendarInputSchema>;

export const EventSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
  colorId: z.string().optional(),

  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),

  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),

  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),

  organizer: z
    .object({
      id: z.string().optional(),
      email: z.string().optional(),
      displayName: z.string().optional(),
      self: z.boolean().optional(),
    })
    .optional(),

  attendees: z
    .array(
      z.object({
        id: z.string().optional(),
        email: z.string().optional(),
        displayName: z.string().optional(),
        organizer: z.boolean().optional(),
        self: z.boolean().optional(),
        resource: z.boolean().optional(),
        optional: z.boolean().optional(),
        responseStatus: z.string().optional(),
        comment: z.string().optional(),
      })
    )
    .optional(),

  conferenceData: z
    .object({
      entryPoints: z
        .array(
          z.object({
            entryPointType: z.string().optional(),
            uri: z.url().optional(),
            label: z.string().optional(),
            pin: z.string().optional(),
            accessCode: z.string().optional(),
            meetingCode: z.string().optional(),
            passcode: z.string().optional(),
            password: z.string().optional(),
          })
        )
        .optional(),
      conferenceSolution: z
        .object({
          key: z
            .object({
              type: z.string().optional(),
            })
            .optional(),
          name: z.string().optional(),
          iconUri: z.string().optional(),
        })
        .optional(),
      conferenceId: z.string().optional(),
    })
    .optional(),
});

export type Event = z.infer<typeof EventSchema>;

// Input for creating an event (ID is assigned by Google)
export const CreateEventInputSchema = EventSchema.omit({
  id: true,
  htmlLink: true,
  organizer: true,
});

export type CreateEvent = z.infer<typeof CreateEventInputSchema>;
