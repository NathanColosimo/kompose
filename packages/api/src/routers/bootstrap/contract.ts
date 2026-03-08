import {
  CalendarSchema,
  ColorsSchema,
  EventSchema,
} from "@kompose/google-cal/schema";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { tagSelectSchemaWithIcon } from "../tag/contract";
import { taskSelectSchemaWithTags } from "../task/contract";

export const bootstrapGoogleAccountSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  providerId: z.string(),
});

export const bootstrapGoogleAccountProfileSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  name: z.string(),
});

const visibleCalendarIdentifierSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
});

export const dashboardBootstrapInputSchema = z.object({
  timeMin: z.iso
    .datetime({ offset: true })
    .describe("Start of the initial calendar bootstrap window."),
  timeMax: z.iso
    .datetime({ offset: true })
    .describe("End of the initial calendar bootstrap window."),
  visibleCalendars: z
    .array(visibleCalendarIdentifierSchema)
    .nullable()
    .optional()
    .describe(
      "Calendars currently visible in the UI. When omitted/null, bootstrap warms events for all currently available calendars."
    ),
});

const bootstrapCalendarsByAccountSchema = z.object({
  accountId: z.string(),
  calendars: z.array(CalendarSchema),
});

const bootstrapColorsByAccountSchema = z.object({
  accountId: z.string(),
  colors: ColorsSchema,
});

const bootstrapEventsByCalendarSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  events: z.array(EventSchema),
});

export const dashboardBootstrapOutputSchema = z.object({
  googleAccounts: z.array(bootstrapGoogleAccountSchema),
  googleAccountProfiles: z.array(bootstrapGoogleAccountProfileSchema),
  googleCalendars: z.array(bootstrapCalendarsByAccountSchema),
  googleColors: z.array(bootstrapColorsByAccountSchema),
  googleEvents: z.array(bootstrapEventsByCalendarSchema),
  tasks: z.array(taskSelectSchemaWithTags),
  tags: z.array(tagSelectSchemaWithIcon),
});

export const dashboardBootstrap = oc
  .input(dashboardBootstrapInputSchema)
  .output(dashboardBootstrapOutputSchema);

export const bootstrapContract = {
  dashboard: dashboardBootstrap,
};

export type BootstrapGoogleAccount = z.infer<
  typeof bootstrapGoogleAccountSchema
>;
export type BootstrapGoogleAccountProfile = z.infer<
  typeof bootstrapGoogleAccountProfileSchema
>;
export type DashboardBootstrapInput = z.infer<
  typeof dashboardBootstrapInputSchema
>;
export type DashboardBootstrapOutput = z.infer<
  typeof dashboardBootstrapOutputSchema
>;
