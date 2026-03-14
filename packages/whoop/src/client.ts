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
      try: () =>
        fetch(buildUrl(path, params), {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      catch: (cause) =>
        new WhoopApiError({
          operation,
          message: `Network error during ${operation}`,
          status: null,
          cause,
        }),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () =>
          new WhoopApiError({
            operation,
            message: `Failed to read error body during ${operation}`,
            status: response.status,
            cause: null,
          }),
      });
      return yield* new WhoopApiError({
        operation,
        message: `WHOOP API error during ${operation}: ${response.status}`,
        status: response.status,
        cause: body,
      });
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) =>
        new WhoopParseError({
          operation,
          message: `Failed to parse JSON during ${operation}`,
          cause,
        }),
    });

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return yield* new WhoopParseError({
        operation,
        message: `Schema validation failed during ${operation}`,
        cause: parsed.error.flatten(),
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
