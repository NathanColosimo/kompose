import { Database } from "@kompose/db";
import { account as accountTable } from "@kompose/db/schema/auth";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { getAccountInfo } from "./account-info";

export interface LinkedAccountWithProfile {
  accountId: string;
  email: string;
  id: string;
  image: string | null;
  name: string;
  providerId: string;
}

/**
 * Resolve linked auth accounts and enrich them with provider profile metadata.
 * This keeps account/profile shaping in one place for both account routes and bootstrap.
 */
export const listLinkedAccountsWithProfile = Effect.fn(
  "AccountRepository.listLinkedAccountsWithProfile"
)(function* (userId: string) {
  const db = yield* Database;
  const accounts = yield* db
    .select()
    .from(accountTable)
    .where(eq(accountTable.userId, userId))
    .pipe(
      Effect.mapError(
        (cause) => new Error("Failed to list linked accounts", { cause })
      )
    );

  return yield* Effect.forEach(
    accounts,
    (account) =>
      Effect.tryPromise({
        try: async () => {
          const info = await getAccountInfo({
            accountId: account.accountId,
            userId,
          });

          return {
            id: account.id,
            accountId: account.accountId,
            providerId: account.providerId,
            email: info.email,
            name: info.name,
            image: info.image,
          };
        },
        catch: (cause) =>
          new Error("Failed to enrich linked account profile", { cause }),
      }),
    { concurrency: "unbounded" }
  );
});
