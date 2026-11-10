CREATE TYPE "connection_status" AS ENUM('active', 'needs-reauth');--> statement-breakpoint
CREATE TABLE "connection" (
	"account_id" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"plugin_id" text NOT NULL,
	"status" "connection_status" DEFAULT 'active'::"connection_status" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "connection_user_idx" ON "connection" ("user_id");--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_account_id_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Connect accounts linked before plugins existed. Matches the providers in
-- @kompose/plugins; new links get their row from the account hook in @kompose/auth.
INSERT INTO "connection" ("account_id", "id", "plugin_id", "user_id")
SELECT "id", gen_random_uuid(), CASE "provider_id" WHEN 'google' THEN 'google-calendar' ELSE 'whoop' END, "user_id"
FROM "account"
WHERE "provider_id" IN ('google', 'whoop');
