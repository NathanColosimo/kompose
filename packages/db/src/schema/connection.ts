import { pluginIds } from "@kompose/plugins";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
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
    /**
     * `email`, `image` and `name` are the provider account's profile, copied
     * here so listing connections asks no provider. See documents/plugins.md.
     */
    email: text("email"),
    id: uuid("id").primaryKey(),
    image: text("image"),
    name: text("name"),
    /** Text, not a Postgres enum, so a new plugin needs no migration. */
    pluginId: text("plugin_id", { enum: pluginIds }).notNull(),
    /** When the profile was last written; null until it is first fetched. */
    profileUpdatedAt: timestamp("profile_updated_at", { mode: "string" }),
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

export const connectionSelectSchema = createSelectSchema(connectionTable);
