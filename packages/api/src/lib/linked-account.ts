import { auth } from "@kompose/auth";
import { getLinkedAccountId } from "@kompose/auth/accounts";
import { APIError } from "better-auth/api";
import { Brand, Effect, Schema } from "effect";
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
 * A provider account the user was confirmed to own. Only `requireLinkedAccount`
 * creates one, so an access token can't be fetched without that check, and
 * Better Auth's row ID can't be mixed up with the provider's account ID.
 */
export type LinkedAccount = Brand.Branded<
  {
    /** The provider's account ID, as used by the app and cache keys. */
    readonly accountId: string;
    /** Better Auth's row ID for the account, as its token APIs expect. */
    readonly authAccountId: string;
    readonly providerId: LinkedProvider;
    readonly userId: string;
  },
  "LinkedAccount"
>;

const LinkedAccount = Brand.nominal<LinkedAccount>();

/**
 * Better Auth reports a missing account or a failed refresh as an `APIError`;
 * anything else (such as a database failure) is a defect.
 */
function failOnAuthError(params: {
  accountId: string;
  providerId: LinkedProvider;
}) {
  return ({ cause }: { readonly cause?: unknown }) =>
    cause instanceof APIError
      ? Effect.fail(
          new LinkedAccountError({
            accountId: params.accountId,
            cause,
            providerId: params.providerId,
          })
        )
      : Effect.die(cause);
}

/**
 * Confirms the user owns this provider account (one DB query). Cache keys use
 * the provider's account ID, so this must run before any cache read.
 */
export const requireLinkedAccount = Effect.fn("requireLinkedAccount")(
  function* (params: {
    accountId: string;
    providerId: LinkedProvider;
    userId: string;
  }) {
    yield* Effect.annotateCurrentSpan("userId", params.userId);
    yield* Effect.annotateCurrentSpan("accountId", params.accountId);

    const authAccountId = yield* Effect.tryPromise(() =>
      getLinkedAccountId({
        providerAccountId: params.accountId,
        providerId: params.providerId,
        userId: params.userId,
      })
    ).pipe(Effect.catch(failOnAuthError(params)));

    return LinkedAccount({ ...params, authAccountId });
  }
);

/**
 * A valid access token for an owned account. Better Auth looks the account up
 * again and may refresh the token (the WHOOP plugin also takes a row lock), so
 * cached reads call this only on a miss.
 */
export const getLinkedAccessToken = Effect.fn("getLinkedAccessToken")(
  function* (account: LinkedAccount) {
    yield* Effect.annotateCurrentSpan("userId", account.userId);
    yield* Effect.annotateCurrentSpan("accountId", account.accountId);

    const { accessToken } = yield* Effect.tryPromise(() =>
      auth.api.getAccessToken({
        body: { accountId: account.authAccountId, userId: account.userId },
      })
    ).pipe(Effect.catch(failOnAuthError(account)));

    if (!accessToken) {
      return yield* new LinkedAccountError({
        accountId: account.accountId,
        cause: new Error("Better Auth returned no access token"),
        providerId: account.providerId,
      });
    }
    return accessToken;
  }
);
