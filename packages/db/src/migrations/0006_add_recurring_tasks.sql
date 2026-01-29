ALTER TABLE "task" ADD COLUMN "series_master_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "recurrence" jsonb;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "is_exception" boolean DEFAULT false NOT NULL;