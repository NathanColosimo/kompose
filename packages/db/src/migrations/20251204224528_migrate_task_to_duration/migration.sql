ALTER TABLE "task" ADD COLUMN "duration_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "end_time";