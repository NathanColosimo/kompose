import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/zod";
import z from "zod";
import { account, user } from "./auth";

export const webhookSubscriptionProviderSchema = z.enum(["google"]);

const googleCalendarEventsWebhookConfigBaseSchema = z
  .object({
    calendarId: z.string().min(1),
    type: z.literal("google-calendar-events"),
  })
  .strict();

const googleCalendarListWebhookConfigBaseSchema = z
  .object({
    type: z.literal("google-calendar-list"),
  })
  .strict();

export const webhookSubscriptionConfigBaseSchema = z.discriminatedUnion(
  "type",
  [
    googleCalendarEventsWebhookConfigBaseSchema,
    googleCalendarListWebhookConfigBaseSchema,
  ]
);

export const googleCalendarEventsWebhookConfigSchema =
  googleCalendarEventsWebhookConfigBaseSchema
    .extend({
      resourceId: z.string().min(1),
    })
    .strict();

export const googleCalendarListWebhookConfigSchema =
  googleCalendarListWebhookConfigBaseSchema
    .extend({
      resourceId: z.string().min(1),
    })
    .strict();

export const webhookSubscriptionConfigSchema = z.discriminatedUnion("type", [
  googleCalendarEventsWebhookConfigSchema,
  googleCalendarListWebhookConfigSchema,
]);

export type WebhookSubscriptionProvider = z.infer<
  typeof webhookSubscriptionProviderSchema
>;
export type WebhookSubscriptionConfigBase = z.infer<
  typeof webhookSubscriptionConfigBaseSchema
>;
export type WebhookSubscriptionConfig = z.infer<
  typeof webhookSubscriptionConfigSchema
>;
export type GoogleCalendarEventsWebhookConfig = z.infer<
  typeof googleCalendarEventsWebhookConfigSchema
>;
export type GoogleCalendarListWebhookConfig = z.infer<
  typeof googleCalendarListWebhookConfigSchema
>;

export const webhookSubscriptionTable = pgTable(
  "webhook_subscription",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    config: jsonb("config").$type<WebhookSubscriptionConfig>().notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    id: uuid("id").notNull().primaryKey(),
    lastNotifiedAt: timestamp("last_notified_at", { mode: "string" }),
    provider: text("provider").$type<WebhookSubscriptionProvider>().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date().toISOString()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    webhookToken: text("webhook_token"),
  },
  (table) => [
    uniqueIndex("webhook_subscription_provider_user_account_config_unique").on(
      table.provider,
      table.userId,
      table.accountId,
      table.config
    ),
    index("webhook_subscription_provider_user_idx").on(
      table.provider,
      table.userId
    ),
    index("webhook_subscription_provider_account_idx").on(
      table.provider,
      table.accountId
    ),
  ]
);

export const webhookSubscriptionSelectSchema = createSelectSchema(
  webhookSubscriptionTable
).safeExtend({
  config: webhookSubscriptionConfigSchema,
  provider: webhookSubscriptionProviderSchema,
});

export const webhookSubscriptionInsertSchema = createInsertSchema(
  webhookSubscriptionTable
).safeExtend({
  config: webhookSubscriptionConfigSchema,
  provider: webhookSubscriptionProviderSchema,
});

export const webhookSubscriptionUpdateSchema = createUpdateSchema(
  webhookSubscriptionTable
).safeExtend({
  config: webhookSubscriptionConfigSchema.optional(),
  provider: webhookSubscriptionProviderSchema.optional(),
});

export type WebhookSubscriptionSelect = z.infer<
  typeof webhookSubscriptionSelectSchema
>;
export type WebhookSubscriptionInsert = z.infer<
  typeof webhookSubscriptionInsertSchema
>;
export type WebhookSubscriptionUpdate = z.infer<
  typeof webhookSubscriptionUpdateSchema
>;
