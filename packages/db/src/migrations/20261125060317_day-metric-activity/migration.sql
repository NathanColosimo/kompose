CREATE TABLE "activity" (
	"connection_id" uuid NOT NULL,
	"date" date NOT NULL,
	"details" jsonb NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"external_id" text NOT NULL,
	"id" uuid PRIMARY KEY,
	"kind" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"title" text
);
--> statement-breakpoint
CREATE TABLE "day_metric" (
	"connection_id" uuid,
	"date" date,
	"metric" text,
	"value" double precision NOT NULL,
	CONSTRAINT "day_metric_pkey" PRIMARY KEY("connection_id","date","metric")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activity_connection_external_id_unique" ON "activity" ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "activity_connection_date_idx" ON "activity" ("connection_id","date");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "day_metric" ADD CONSTRAINT "day_metric_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connection"("id") ON DELETE CASCADE;