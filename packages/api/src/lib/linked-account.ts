import { auth } from "@kompose/auth";
import { getLinkedAccountId } from "@kompose/auth/accounts";
import { APIError } from "better-auth/api";
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
 * Confirms the user owns this provider account (one DB query) and returns an
 * effect that gets its access token. Cache keys use the provider's account ID,
 * so run this before any cache read. Getting the token means more queries and
 * maybe a refresh (the WHOOP plugin also takes a row lock), so cached reads run
 * it only on a miss.
 *
 * Better Auth reports a missing account or a failed refresh as an `APIError`;
 * anything else (such as a database failure) is a defect.
 */
export const requireLinkedAccount = Effect.fn("requireLinkedAccount")(
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
    const failOnAuthError = ({ cause }: { readonly cause?: unknown }) =>
      cause instanceof APIError ? Effect.fail(fail(cause)) : Effect.die(cause);

    const authAccountId = yield* Effect.tryPromise(() =>
      getLinkedAccountId({
        providerAccountId: params.accountId,
        providerId: params.providerId,
        userId: params.userId,
      })
    ).pipe(Effect.catch(failOnAuthError));

    return Effect.gen(function* () {
      const { accessToken } = yield* Effect.tryPromise(() =>
        auth.api.getAccessToken({
          body: { accountId: authAccountId, userId: params.userId },
        })
      ).pipe(Effect.catch(failOnAuthError));

      if (!accessToken) {
        return yield* fail(new Error("Better Auth returned no access token"));
      }
      return accessToken;
    }).pipe(
      Effect.withSpan("getLinkedAccessToken", {
        attributes: { accountId: params.accountId, userId: params.userId },
      })
    );
  }
);
