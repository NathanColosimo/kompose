import { sql } from "drizzle-orm";

/** Use inside a transaction, before reading either account state or channels. */
export function webhookAccountLock(accountId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${accountId}, 74021))`;
}
