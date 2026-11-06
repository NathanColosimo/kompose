import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { account } from "./auth";

/** Provider capability failures and unlink intent outlive individual channels. */
export const webhookAccountStateTable = pgTable("webhook_account_state", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => account.id, { onDelete: "cascade" }),
  unlinkingUntil: timestamp("unlinking_until", { mode: "string" }),
  unsupportedUntil: jsonb("unsupported_until")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
});
