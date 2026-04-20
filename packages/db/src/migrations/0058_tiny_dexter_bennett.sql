CREATE TABLE "boardroom_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"created_by_agent_id" uuid,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_payload" jsonb,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boardroom_cards" ADD CONSTRAINT "boardroom_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boardroom_cards" ADD CONSTRAINT "boardroom_cards_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boardroom_cards" ADD CONSTRAINT "boardroom_cards_comment_id_issue_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boardroom_cards" ADD CONSTRAINT "boardroom_cards_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boardroom_cards_issue_idx" ON "boardroom_cards" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "boardroom_cards_comment_idx" ON "boardroom_cards" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "boardroom_cards_company_state_idx" ON "boardroom_cards" USING btree ("company_id","state");