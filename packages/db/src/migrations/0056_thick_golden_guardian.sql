-- Rollback:
--   DROP INDEX IF EXISTS "companies_slug_idx";
--   DROP INDEX IF EXISTS "company_slug_redirects_company_idx";
--   DROP TABLE IF EXISTS "company_slug_redirects";
--   ALTER TABLE "companies" DROP COLUMN IF EXISTS "is_draft";
--   ALTER TABLE "companies" DROP COLUMN IF EXISTS "slug";

ALTER TABLE "companies" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "companies" SET "slug" = lower("issue_prefix") WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "slug" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_slug_idx" ON "companies" USING btree ("slug");--> statement-breakpoint

CREATE TABLE "company_slug_redirects" (
	"old_slug" text PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_slug_redirects" ADD CONSTRAINT "company_slug_redirects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_slug_redirects_company_idx" ON "company_slug_redirects" USING btree ("company_id");
