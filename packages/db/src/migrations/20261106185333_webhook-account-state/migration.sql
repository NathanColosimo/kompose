CREATE TABLE "webhook_account_state" (
	"account_id" text PRIMARY KEY,
	"unlinking_until" timestamp,
	"unsupported_until" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_account_state" ADD CONSTRAINT "webhook_account_state_account_id_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;