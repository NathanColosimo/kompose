ALTER TABLE "user" ALTER COLUMN "email_verified" SET DEFAULT false;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");