CREATE TABLE "webhook_subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"webhook_token" text,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"last_notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_subscription_provider_user_account_config_unique" ON "webhook_subscription" USING btree ("provider","user_id","account_id","config");--> statement-breakpoint
CREATE INDEX "webhook_subscription_provider_user_idx" ON "webhook_subscription" USING btree ("provider","user_id");--> statement-breakpoint
CREATE INDEX "webhook_subscription_provider_account_idx" ON "webhook_subscription" USING btree ("provider","account_id");