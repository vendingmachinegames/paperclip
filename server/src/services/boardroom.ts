import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";

/**
 * The Boardroom is a company-scoped group chat — a single issue of
 * `kind = 'conversation'` per company that all agents participate in.
 *
 * Lifecycle:
 * - Auto-created when a company is created.
 * - Idempotently recreated by `getOrCreate()` if somehow missing
 *   (e.g., imports, crash during company create, historic data).
 *
 * The Boardroom does NOT get an issue number / identifier — it's not a
 * ticket. It has no project, no goal, no assignee.
 */
export function boardroomService(db: Db) {
  async function findForCompany(companyId: string) {
    const rows = await db
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.kind, "conversation")))
      .limit(1);
    return rows[0] ?? null;
  }

  async function create(companyId: string) {
    const [row] = await db
      .insert(issues)
      .values({
        companyId,
        kind: "conversation",
        title: "Boardroom",
        status: "active",
        originKind: "system",
      })
      .returning();
    if (!row) throw new Error("Failed to create Boardroom");
    return row;
  }

  return {
    findForCompany,
    create,
    async getOrCreate(companyId: string) {
      const existing = await findForCompany(companyId);
      if (existing) return existing;
      return create(companyId);
    },
  };
}

export type BoardroomService = ReturnType<typeof boardroomService>;
