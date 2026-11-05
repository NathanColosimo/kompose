DROP INDEX "account_user_provider_idx";--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");