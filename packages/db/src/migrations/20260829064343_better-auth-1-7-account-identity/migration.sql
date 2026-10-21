-- Recorded after the fact: this migration was applied to production on
-- 2026-08-29 for better-auth 1.7.0-1.7.2's issuer-based account identity, but
-- was never committed. better-auth 1.7.3 stopped writing `issuer`; a later
-- migration drops it.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = 'local:oauth:' || "provider_id";--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_idx" ON "account" ("issuer","account_id");
