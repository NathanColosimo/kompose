CREATE INDEX "account_user_provider_idx" ON "account" ("user_id","provider_id");--> statement-breakpoint
CREATE INDEX "task_user_created_at_idx" ON "task" ("user_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "task_series_master_idx" ON "task" ("series_master_id");