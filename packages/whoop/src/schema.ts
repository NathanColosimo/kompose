import z from "zod";

const whoopDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const whoopDateTimeSchema = z.iso.datetime({ offset: true });
/**
 * SCORED means the cycle was scored and the measurement values will be present.
 * PENDING_SCORE means WHOOP is currently evaluating the cycle.
 * UNSCORABLE means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range.
 */
const whoopScoreStateSchema = z.enum(["SCORED", "PENDING_SCORE", "UNSCORABLE"]);

export const whoopProfileBasicSchema = z
  .object({
    user_id: z.number().int(),
    email: z.email(),
    first_name: z.string(),
    last_name: z.string(),
  })
  .loose();

export const whoopCycleScoreSchema = z
  .object({
    strain: z.number().nullable().optional(),
    kilojoule: z.number().nullable().optional(),
    average_heart_rate: z.number().int().nullable().optional(),
    max_heart_rate: z.number().int().nullable().optional(),
  })
  .loose();

export const whoopCycleSchema = z
  .object({
    id: z.number().int(),
    user_id: z.number().int(),
    created_at: whoopDateTimeSchema,
    updated_at: whoopDateTimeSchema,
    start: whoopDateTimeSchema,
    end: whoopDateTimeSchema.nullable().optional(),
    timezone_offset: z.string(),
    score_state: whoopScoreStateSchema,
    score: whoopCycleScoreSchema.nullable().optional(),
  })
  .loose();

export const whoopRecoveryScoreSchema = z
  .object({
    user_calibrating: z.boolean().nullable().optional(),
    recovery_score: z.number().int().nullable().optional(),
    resting_heart_rate: z.number().int().nullable().optional(),
    hrv_rmssd_milli: z.number().nullable().optional(),
    spo2_percentage: z.number().nullable().optional(),
    skin_temp_celsius: z.number().nullable().optional(),
  })
  .loose();

export const whoopRecoverySchema = z
  .object({
    cycle_id: z.number().int(),
    sleep_id: z.string().uuid(),
    user_id: z.number().int(),
    created_at: whoopDateTimeSchema,
    updated_at: whoopDateTimeSchema,
    score_state: whoopScoreStateSchema,
    score: whoopRecoveryScoreSchema.nullable().optional(),
  })
  .loose();

export const whoopSleepStageSummarySchema = z
  .object({
    total_in_bed_time_milli: z.number().int().nullable().optional(),
    total_awake_time_milli: z.number().int().nullable().optional(),
    total_no_data_time_milli: z.number().int().nullable().optional(),
    total_light_sleep_time_milli: z.number().int().nullable().optional(),
    total_slow_wave_sleep_time_milli: z.number().int().nullable().optional(),
    total_rem_sleep_time_milli: z.number().int().nullable().optional(),
    sleep_cycle_count: z.number().int().nullable().optional(),
    disturbance_count: z.number().int().nullable().optional(),
  })
  .passthrough();

export const whoopSleepNeededSchema = z
  .object({
    baseline_milli: z.number().int().nullable().optional(),
    need_from_sleep_debt_milli: z.number().int().nullable().optional(),
    need_from_recent_strain_milli: z.number().int().nullable().optional(),
    need_from_recent_nap_milli: z.number().int().nullable().optional(),
  })
  .loose();

export const whoopSleepScoreSchema = z
  .object({
    stage_summary: whoopSleepStageSummarySchema.nullable().optional(),
    sleep_needed: whoopSleepNeededSchema.nullable().optional(),
    respiratory_rate: z.number().nullable().optional(),
    sleep_performance_percentage: z.number().int().nullable().optional(),
    sleep_consistency_percentage: z.number().int().nullable().optional(),
    sleep_efficiency_percentage: z.number().nullable().optional(),
  })
  .loose();

export const whoopSleepSchema = z
  .object({
    id: z.string().uuid(),
    cycle_id: z.number().int(),
    v1_id: z.number().int().nullable().optional(),
    user_id: z.number().int(),
    created_at: whoopDateTimeSchema,
    updated_at: whoopDateTimeSchema,
    start: whoopDateTimeSchema,
    end: whoopDateTimeSchema,
    timezone_offset: z.string(),
    nap: z.boolean(),
    score_state: whoopScoreStateSchema,
    score: whoopSleepScoreSchema.nullable().optional(),
  })
  .loose();

export const whoopWorkoutZoneDurationsSchema = z
  .object({
    zone_zero_milli: z.number().int().nullable().optional(),
    zone_one_milli: z.number().int().nullable().optional(),
    zone_two_milli: z.number().int().nullable().optional(),
    zone_three_milli: z.number().int().nullable().optional(),
    zone_four_milli: z.number().int().nullable().optional(),
    zone_five_milli: z.number().int().nullable().optional(),
  })
  .passthrough();

export const whoopWorkoutScoreSchema = z
  .object({
    strain: z.number().nullable().optional(),
    average_heart_rate: z.number().int().nullable().optional(),
    max_heart_rate: z.number().int().nullable().optional(),
    kilojoule: z.number().nullable().optional(),
    percent_recorded: z.number().nullable().optional(),
    distance_meter: z.number().nullable().optional(),
    altitude_gain_meter: z.number().nullable().optional(),
    altitude_change_meter: z.number().nullable().optional(),
    zone_durations: whoopWorkoutZoneDurationsSchema.nullable().optional(),
  })
  .loose();

export const whoopWorkoutSchema = z
  .object({
    id: z.string().uuid(),
    v1_id: z.number().int().nullable().optional(),
    user_id: z.number().int(),
    created_at: whoopDateTimeSchema,
    updated_at: whoopDateTimeSchema,
    start: whoopDateTimeSchema,
    end: whoopDateTimeSchema,
    timezone_offset: z.string(),
    sport_name: z.string(),
    score_state: whoopScoreStateSchema,
    score: whoopWorkoutScoreSchema.nullable().optional(),
    sport_id: z.number().int().nullable().optional(),
  })
  .loose();

export const whoopCollectionResponseSchema = <T extends z.ZodTypeAny>(
  recordSchema: T
) =>
  z
    .object({
      records: z.array(recordSchema),
      next_token: z.string().nullable().optional(),
    })
    .loose();

export const whoopCycleCollectionSchema =
  whoopCollectionResponseSchema(whoopCycleSchema);
export const whoopRecoveryCollectionSchema =
  whoopCollectionResponseSchema(whoopRecoverySchema);
export const whoopSleepCollectionSchema =
  whoopCollectionResponseSchema(whoopSleepSchema);
export const whoopWorkoutCollectionSchema =
  whoopCollectionResponseSchema(whoopWorkoutSchema);

export const whoopCachedDayRawSchema = z.object({
  day: whoopDateSchema,
  cycle: whoopCycleSchema.nullable(),
  recovery: whoopRecoverySchema.nullable(),
  sleeps: z.array(whoopSleepSchema),
  workouts: z.array(whoopWorkoutSchema),
});

export const whoopCachedDayRawArraySchema = z.array(whoopCachedDayRawSchema);

export type WhoopProfileBasic = z.infer<typeof whoopProfileBasicSchema>;
export type WhoopCycle = z.infer<typeof whoopCycleSchema>;
export type WhoopRecovery = z.infer<typeof whoopRecoverySchema>;
export type WhoopSleep = z.infer<typeof whoopSleepSchema>;
export type WhoopWorkout = z.infer<typeof whoopWorkoutSchema>;
export type WhoopCachedDayRaw = z.infer<typeof whoopCachedDayRawSchema>;
