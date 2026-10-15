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
    email: z.email(),
    first_name: z.string(),
    last_name: z.string(),
    user_id: z.number().int(),
  })
  .loose();

export const whoopCycleScoreSchema = z
  .object({
    average_heart_rate: z.number().int().nullable().optional(),
    kilojoule: z.number().nullable().optional(),
    max_heart_rate: z.number().int().nullable().optional(),
    strain: z.number().nullable().optional(),
  })
  .loose();

export const whoopCycleSchema = z
  .object({
    created_at: whoopDateTimeSchema,
    end: whoopDateTimeSchema.nullable().optional(),
    id: z.number().int(),
    score: whoopCycleScoreSchema.nullable().optional(),
    score_state: whoopScoreStateSchema,
    start: whoopDateTimeSchema,
    timezone_offset: z.string(),
    updated_at: whoopDateTimeSchema,
    user_id: z.number().int(),
  })
  .loose();

export const whoopRecoveryScoreSchema = z
  .object({
    hrv_rmssd_milli: z.number().nullable().optional(),
    recovery_score: z.number().int().nullable().optional(),
    resting_heart_rate: z.number().int().nullable().optional(),
    skin_temp_celsius: z.number().nullable().optional(),
    spo2_percentage: z.number().nullable().optional(),
    user_calibrating: z.boolean().nullable().optional(),
  })
  .loose();

export const whoopRecoverySchema = z
  .object({
    created_at: whoopDateTimeSchema,
    cycle_id: z.number().int(),
    score: whoopRecoveryScoreSchema.nullable().optional(),
    score_state: whoopScoreStateSchema,
    sleep_id: z.string().uuid(),
    updated_at: whoopDateTimeSchema,
    user_id: z.number().int(),
  })
  .loose();

export const whoopSleepStageSummarySchema = z
  .object({
    disturbance_count: z.number().int().nullable().optional(),
    sleep_cycle_count: z.number().int().nullable().optional(),
    total_awake_time_milli: z.number().int().nullable().optional(),
    total_in_bed_time_milli: z.number().int().nullable().optional(),
    total_light_sleep_time_milli: z.number().int().nullable().optional(),
    total_no_data_time_milli: z.number().int().nullable().optional(),
    total_rem_sleep_time_milli: z.number().int().nullable().optional(),
    total_slow_wave_sleep_time_milli: z.number().int().nullable().optional(),
  })
  .passthrough();

export const whoopSleepNeededSchema = z
  .object({
    baseline_milli: z.number().int().nullable().optional(),
    need_from_recent_nap_milli: z.number().int().nullable().optional(),
    need_from_recent_strain_milli: z.number().int().nullable().optional(),
    need_from_sleep_debt_milli: z.number().int().nullable().optional(),
  })
  .loose();

export const whoopSleepScoreSchema = z
  .object({
    respiratory_rate: z.number().nullable().optional(),
    sleep_consistency_percentage: z.number().int().nullable().optional(),
    sleep_efficiency_percentage: z.number().nullable().optional(),
    sleep_needed: whoopSleepNeededSchema.nullable().optional(),
    sleep_performance_percentage: z.number().int().nullable().optional(),
    stage_summary: whoopSleepStageSummarySchema.nullable().optional(),
  })
  .loose();

export const whoopSleepSchema = z
  .object({
    created_at: whoopDateTimeSchema,
    cycle_id: z.number().int(),
    end: whoopDateTimeSchema,
    id: z.string().uuid(),
    nap: z.boolean(),
    score: whoopSleepScoreSchema.nullable().optional(),
    score_state: whoopScoreStateSchema,
    start: whoopDateTimeSchema,
    timezone_offset: z.string(),
    updated_at: whoopDateTimeSchema,
    user_id: z.number().int(),
    v1_id: z.number().int().nullable().optional(),
  })
  .loose();

export const whoopWorkoutZoneDurationsSchema = z
  .object({
    zone_five_milli: z.number().int().nullable().optional(),
    zone_four_milli: z.number().int().nullable().optional(),
    zone_one_milli: z.number().int().nullable().optional(),
    zone_three_milli: z.number().int().nullable().optional(),
    zone_two_milli: z.number().int().nullable().optional(),
    zone_zero_milli: z.number().int().nullable().optional(),
  })
  .passthrough();

export const whoopWorkoutScoreSchema = z
  .object({
    altitude_change_meter: z.number().nullable().optional(),
    altitude_gain_meter: z.number().nullable().optional(),
    average_heart_rate: z.number().int().nullable().optional(),
    distance_meter: z.number().nullable().optional(),
    kilojoule: z.number().nullable().optional(),
    max_heart_rate: z.number().int().nullable().optional(),
    percent_recorded: z.number().nullable().optional(),
    strain: z.number().nullable().optional(),
    zone_durations: whoopWorkoutZoneDurationsSchema.nullable().optional(),
  })
  .loose();

export const whoopWorkoutSchema = z
  .object({
    created_at: whoopDateTimeSchema,
    end: whoopDateTimeSchema,
    id: z.string().uuid(),
    score: whoopWorkoutScoreSchema.nullable().optional(),
    score_state: whoopScoreStateSchema,
    sport_id: z.number().int().nullable().optional(),
    sport_name: z.string(),
    start: whoopDateTimeSchema,
    timezone_offset: z.string(),
    updated_at: whoopDateTimeSchema,
    user_id: z.number().int(),
    v1_id: z.number().int().nullable().optional(),
  })
  .loose();

export const whoopCollectionResponseSchema = <T extends z.ZodTypeAny>(
  recordSchema: T
) =>
  z
    .object({
      next_token: z.string().nullable().optional(),
      records: z.array(recordSchema),
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
  cycle: whoopCycleSchema.nullable(),
  day: whoopDateSchema,
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
