import { oc } from "@orpc/contract";
import z from "zod";

const plainDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const whoopSleepSummarySchema = z.object({
  end: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  totalSleepMilliseconds: z.number().int().nonnegative(),
});

export const whoopWorkoutSummarySchema = z.object({
  end: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  sportId: z.number().int().nullable(),
  sportName: z.string().nullable(),
  start: z.iso.datetime({ offset: true }),
  strainScore: z.number().nullable(),
});

export const whoopDaySummarySchema = z.object({
  cycleId: z.number().int().nullable(),
  day: plainDateSchema,
  kilojoule: z.number().nullable(),
  naps: z.array(whoopSleepSummarySchema),
  recoveryScore: z.number().int().nullable(),
  sleep: whoopSleepSummarySchema.nullable(),
  sleepPerformance: z.number().int().nullable(),
  strainScore: z.number().nullable(),
  workouts: z.array(whoopWorkoutSummarySchema),
});

export const whoopDaysListInputSchema = z.object({
  accountId: z.string().min(1),
  endDate: plainDateSchema,
  startDate: plainDateSchema,
  timeZone: z.string().min(1),
});

export const whoopContract = {
  days: {
    list: oc
      .input(whoopDaysListInputSchema)
      .output(z.array(whoopDaySummarySchema)),
  },
};

export type WhoopDaySummary = z.infer<typeof whoopDaySummarySchema>;
