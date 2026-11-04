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
 * A valid access token for one of the user's linked provider accounts.
 *
 * `accountId` is the provider's account ID, which the app uses everywhere
 * (RPC inputs, cache keys). Better Auth's token API takes the local
 * `account.id`, so this first finds the row the user owns. A missing row, or a
 * Better Auth `APIError` (no account, failed refresh), is a
 * `LinkedAccountError`; anything else, such as a database failure, is a defect.
 */
export const getLinkedAccessToken = Effect.fn("getLinkedAccessToken")(
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

    const { accessToken } = yield* Effect.tryPromise(() =>
      auth.api.getAccessToken({
        body: { accountId: row.id, userId: params.userId },
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
