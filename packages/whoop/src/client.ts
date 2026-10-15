import { Effect } from "effect";
import type z from "zod";
import { WhoopApiError, WhoopParseError } from "./errors";
import {
  type WhoopCycle,
  type WhoopProfileBasic,
  type WhoopRecovery,
  type WhoopSleep,
  type WhoopWorkout,
  whoopCycleCollectionSchema,
  whoopProfileBasicSchema,
  whoopRecoveryCollectionSchema,
  whoopSleepCollectionSchema,
  whoopWorkoutCollectionSchema,
} from "./schema";

const WHOOP_API_BASE_URL = "https://api.prod.whoop.com";

export interface WhoopListParams {
  end: string;
  start: string;
}

function buildUrl(path: string, params: Record<string, string | undefined>) {
  const url = new URL(path, WHOOP_API_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function fetchPage<T>(
  accessToken: string,
  path: string,
  params: Record<string, string | undefined>,
  schema: z.ZodType<T>,
  operation: string
): Effect.Effect<T, WhoopApiError | WhoopParseError> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new WhoopApiError({
          cause,
          message: `Network error during ${operation}`,
          operation,
          status: null,
        }),
      try: () =>
        fetch(buildUrl(path, params), {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        catch: () =>
          new WhoopApiError({
            cause: null,
            message: `Failed to read error body during ${operation}`,
            operation,
            status: response.status,
          }),
        try: () => response.text(),
      });
      return yield* new WhoopApiError({
        cause: body,
        message: `WHOOP API error during ${operation}: ${response.status}`,
        operation,
        status: response.status,
      });
    }

    const json = yield* Effect.tryPromise({
      catch: (cause) =>
        new WhoopParseError({
          cause,
          message: `Failed to parse JSON during ${operation}`,
          operation,
        }),
      try: () => response.json() as Promise<unknown>,
    });

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return yield* new WhoopParseError({
        cause: parsed.error.flatten(),
        message: `Schema validation failed during ${operation}`,
        operation,
      });
    }

    return parsed.data;
  });
}

function fetchCollection<T>(
  accessToken: string,
  path: string,
  params: WhoopListParams,
  schema: z.ZodType<{ next_token?: string | null; records: T[] }>,
  operation: string
): Effect.Effect<T[], WhoopApiError | WhoopParseError> {
  return Effect.gen(function* () {
    const records: T[] = [];
    let nextToken: string | undefined;

    do {
      const page = yield* fetchPage(
        accessToken,
        path,
        {
          end: params.end,
          limit: "25",
          nextToken,
          start: params.start,
        },
        schema,
        operation
      );

      records.push(...page.records);
      nextToken = page.next_token ?? undefined;
    } while (nextToken);

    return records;
  });
}

export function createWhoopClient(accessToken: string) {
  return {
    getProfileBasic: (): Effect.Effect<
      WhoopProfileBasic,
      WhoopApiError | WhoopParseError
    > =>
      fetchPage(
        accessToken,
        "/developer/v1/user/profile/basic",
        {},
        whoopProfileBasicSchema,
        "getProfileBasic"
      ),

    listCycles: (
      params: WhoopListParams
    ): Effect.Effect<WhoopCycle[], WhoopApiError | WhoopParseError> =>
      fetchCollection(
        accessToken,
        "/developer/v2/cycle",
        params,
        whoopCycleCollectionSchema,
        "listCycles"
      ),

    listRecoveries: (
      params: WhoopListParams
    ): Effect.Effect<WhoopRecovery[], WhoopApiError | WhoopParseError> =>
      fetchCollection(
        accessToken,
        "/developer/v2/recovery",
        params,
        whoopRecoveryCollectionSchema,
        "listRecoveries"
      ),

    listSleeps: (
      params: WhoopListParams
    ): Effect.Effect<WhoopSleep[], WhoopApiError | WhoopParseError> =>
      fetchCollection(
        accessToken,
        "/developer/v2/activity/sleep",
        params,
        whoopSleepCollectionSchema,
        "listSleeps"
      ),

    listWorkouts: (
      params: WhoopListParams
    ): Effect.Effect<WhoopWorkout[], WhoopApiError | WhoopParseError> =>
      fetchCollection(
        accessToken,
        "/developer/v2/activity/workout",
        params,
        whoopWorkoutCollectionSchema,
        "listWorkouts"
      ),
  };
}

export type WhoopClient = ReturnType<typeof createWhoopClient>;
