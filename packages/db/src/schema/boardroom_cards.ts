import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { issueComments } from "./issue_comments.js";
import { agents } from "./agents.js";

export const boardroomCards = pgTable(
  "boardroom_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").notNull().references(() => issueComments.id, { onDelete: "cascade" }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("pending"),
    payload: jsonb("payload").notNull().default({}),
    resultPayload: jsonb("result_payload"),
    resolvedByUserId: text("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueIdx: index("boardroom_cards_issue_idx").on(table.issueId),
    commentIdx: index("boardroom_cards_comment_idx").on(table.commentId),
    companyStateIdx: index("boardroom_cards_company_state_idx").on(table.companyId, table.state),
  }),
);
