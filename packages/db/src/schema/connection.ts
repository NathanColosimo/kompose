import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { account, user } from "./auth";

/** `needs-reauth`: the provider rejected our refresh token; Settings shows Reconnect. */
export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "needs-reauth",
]);

/**
 * A user's connection to a plugin (see documents/plugins.md). OAuth plugins
 * have one per linked Better Auth account; the account holds the tokens.
 */
export const connectionTable = pgTable(
  "connection",
  {
    accountId: text("account_id")
      .notNull()
      .unique()
      .references(() => account.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    id: uuid("id").primaryKey(),
    /** A plugin ID from @kompose/plugins. */
    pluginId: text("plugin_id").notNull(),
    status: connectionStatusEnum("status").notNull().default("active"),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date().toISOString()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("connection_user_idx").on(table.userId)]
);
