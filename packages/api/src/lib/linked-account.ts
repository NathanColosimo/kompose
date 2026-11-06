import { auth } from "@kompose/auth";
import { Database } from "@kompose/db";
import { account } from "@kompose/db/schema/auth";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { PublicError } from "../errors";

const PROVIDER_NAMES = { google: "Google", whoop: "WHOOP" } as const;

type LinkedProvider = keyof typeof PROVIDER_NAMES;

/**
 * The user's provider account isn't linked, or Better Auth couldn't refresh
 * its access token (often a revoked grant).
 */
export class LinkedAccountError extends Schema.TaggedError<LinkedAccountError>()(
  "LinkedAccountError",
  {
    accountId: Schema.String,
    cause: Schema.Unknown,
    providerId: Schema.Literals(["google", "whoop"]),
  }
) {
  get publicError(): PublicError {
    const provider = PROVIDER_NAMES[this.providerId];
    return {
      code: "PRECONDITION_FAILED",
      message: `Couldn't access your ${provider} account. If this keeps happening, reconnect it in Settings.`,
    };
  }
}

/**
 * Resolve the provider account ID to a user-owned local `account.id` for
 * Better Auth. See documents/caching.md for the account ID invariant.
 * Missing or ambiguous rows yield LinkedAccountError;
 * unexpected failures, including database errors, are defects.
 */
export const getLinkedAccount = Effect.fn("getLinkedAccount")(
  function* (params: {
    accountId: string;
    providerId: LinkedProvider;
    userId: string;
  }) {
    yield* Effect.annotateCurrentSpan("userId", params.userId);
    yield* Effect.annotateCurrentSpan("accountId", params.accountId);

    const fail = (cause: unknown) =>
      new LinkedAccountError({
        accountId: params.accountId,
        cause,
        providerId: params.providerId,
      });

    const db = yield* Database;
    const rows = yield* db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.accountId, params.accountId),
          eq(account.providerId, params.providerId),
          eq(account.userId, params.userId)
        )
      )
      .limit(2)
      .pipe(Effect.orDie);

    const [row] = rows;
    if (!row || rows.length > 1) {
      return yield* fail(
        new Error(`Expected one linked account row, found ${rows.length}`)
      );
    }

    return { ...params, id: row.id };
  }
);

export type LinkedAccount = Effect.Success<ReturnType<typeof getLinkedAccount>>;

/** Fetch a token for the exact linkage checked before the cache lookup. */
export const getLinkedAccessToken = Effect.fn("getLinkedAccessToken")(
  function* (link: LinkedAccount) {
    const fail = (cause: unknown) =>
      new LinkedAccountError({
        accountId: link.accountId,
        cause,
        providerId: link.providerId,
      });

    const { accessToken } = yield* Effect.tryPromise(() =>
      auth.api.getAccessToken({
        body: { accountId: link.id, userId: link.userId },
      })
    ).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof APIError ? Effect.fail(fail(cause)) : Effect.die(cause)
      )
    );

    if (!accessToken) {
      return yield* fail(new Error("Better Auth returned no access token"));
    }
    return accessToken;
  }
);
