-- Drop messages first so PostgreSQL removes their foreign key regardless of its name.
DROP TABLE "ai_message";--> statement-breakpoint
DROP TABLE "ai_session";--> statement-breakpoint
DROP TYPE "ai_message_role";
