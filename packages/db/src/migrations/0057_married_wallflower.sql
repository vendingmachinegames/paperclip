-- Rollback:
--   ALTER TABLE "issues" DROP COLUMN IF EXISTS "kind";

ALTER TABLE "companies" ALTER COLUMN "slug" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "kind" text DEFAULT 'task' NOT NULL;
