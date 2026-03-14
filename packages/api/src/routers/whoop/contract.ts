import { oc } from "@orpc/contract";
import z from "zod";

const plainDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const whoopSleepSummarySchema = z.object({
  id: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  totalSleepMilliseconds: z.number().int().nonnegative(),
});

export const whoopWorkoutSummarySchema = z.object({
  id: z.uuid(),
  sportId: z.number().int().nullable(),
  sportName: z.string().nullable(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  strainScore: z.number().nullable(),
});

export const whoopDaySummarySchema = z.object({
  day: plainDateSchema,
  cycleId: z.number().int().nullable(),
  recoveryScore: z.number().int().nullable(),
  strainScore: z.number().nullable(),
  kilojoule: z.number().nullable(),
  sleepPerformance: z.number().int().nullable(),
  sleep: whoopSleepSummarySchema.nullable(),
  naps: z.array(whoopSleepSummarySchema),
  workouts: z.array(whoopWorkoutSummarySchema),
});

export const whoopDaysListInputSchema = z.object({
  accountId: z.string().min(1),
  startDate: plainDateSchema,
  endDate: plainDateSchema,
  timeZone: z.string().min(1),
});

export const whoopProfileOutputSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
});

export type WhoopProfile = z.infer<typeof whoopProfileOutputSchema>;

export const whoopContract = {
  days: {
    list: oc
      .input(whoopDaysListInputSchema)
      .output(z.array(whoopDaySummarySchema)),
  },
  profile: {
    get: oc
      .input(z.object({ accountId: z.string().min(1) }))
      .output(whoopProfileOutputSchema),
  },
};

export type WhoopDaySummary = z.infer<typeof whoopDaySummarySchema>;
