import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { boardroomCards } from "@paperclipai/db";
import { conflict, notFound } from "../errors.js";

export type BoardroomCardState = "pending" | "accepted" | "rejected";

export type BoardroomCardKind = "hire_proposal" | "task_completion";

export interface BoardroomCardRow {
  id: string;
  companyId: string;
  issueId: string;
  commentId: string;
  createdByAgentId: string | null;
  kind: BoardroomCardKind | string;
  state: BoardroomCardState;
  payload: Record<string, unknown>;
  resultPayload: Record<string, unknown> | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateInput {
  companyId: string;
  issueId: string;
  commentId: string;
  createdByAgentId: string | null;
  kind: BoardroomCardKind | string;
  payload: Record<string, unknown>;
}

function normalizeRow(row: typeof boardroomCards.$inferSelect): BoardroomCardRow {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    commentId: row.commentId,
    createdByAgentId: row.createdByAgentId ?? null,
    kind: row.kind,
    state: row.state as BoardroomCardState,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    resultPayload: (row.resultPayload ?? null) as Record<string, unknown> | null,
    resolvedByUserId: row.resolvedByUserId ?? null,
    resolvedAt: row.resolvedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function boardroomCardsService(db: Db) {
  return {
    async create(input: CreateInput): Promise<BoardroomCardRow> {
      const [row] = await db
        .insert(boardroomCards)
        .values({
          companyId: input.companyId,
          issueId: input.issueId,
          commentId: input.commentId,
          createdByAgentId: input.createdByAgentId,
          kind: input.kind,
          payload: input.payload,
        })
        .returning();
      if (!row) throw new Error("Failed to create boardroom card");
      return normalizeRow(row);
    },

    async getById(id: string): Promise<BoardroomCardRow | null> {
      const [row] = await db
        .select()
        .from(boardroomCards)
        .where(eq(boardroomCards.id, id))
        .limit(1);
      return row ? normalizeRow(row) : null;
    },

    async listForIssue(issueId: string): Promise<BoardroomCardRow[]> {
      const rows = await db
        .select()
        .from(boardroomCards)
        .where(eq(boardroomCards.issueId, issueId));
      return rows.map(normalizeRow);
    },

    async listForComments(commentIds: string[]): Promise<BoardroomCardRow[]> {
      if (commentIds.length === 0) return [];
      const rows = await db
        .select()
        .from(boardroomCards)
        .where(inArray(boardroomCards.commentId, commentIds));
      return rows.map(normalizeRow);
    },

    /**
     * Resolve a card atomically — state transitions are one-way from pending.
     * Re-resolving with the same state is a no-op (idempotent); re-resolving
     * with a different state throws.
     */
    async resolve(params: {
      id: string;
      nextState: "accepted" | "rejected";
      resolvedByUserId: string;
      resultPayload?: Record<string, unknown>;
    }): Promise<BoardroomCardRow> {
      const existing = await this.getById(params.id);
      if (!existing) throw notFound("Boardroom card not found");
      if (existing.state === params.nextState) return existing;
      if (existing.state !== "pending") {
        throw conflict(`Card already ${existing.state}`);
      }

      const [row] = await db
        .update(boardroomCards)
        .set({
          state: params.nextState,
          resolvedByUserId: params.resolvedByUserId,
          resolvedAt: new Date(),
          resultPayload: params.resultPayload ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(boardroomCards.id, params.id),
            eq(boardroomCards.state, "pending"),
          ),
        )
        .returning();
      if (!row) {
        // Lost the race — re-read and return. If still pending, someone
        // cleared the state between our check and update; surface that.
        const refreshed = await this.getById(params.id);
        if (!refreshed) throw notFound("Boardroom card not found");
        if (refreshed.state === params.nextState) return refreshed;
        throw conflict(`Card already ${refreshed.state}`);
      }
      return normalizeRow(row);
    },
  };
}

export type BoardroomCardsService = ReturnType<typeof boardroomCardsService>;
