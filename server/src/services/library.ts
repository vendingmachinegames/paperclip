import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  assets,
  documents,
  issueAttachments,
  issueComments,
  issueDocuments,
  issueWorkProducts,
  issues,
} from "@paperclipai/db";

/**
 * A single row in the company-scoped Library — unified across work-products,
 * issue-scoped documents, and file attachments.
 *
 * This is a read-only denormalized view; nothing mutates through here.
 */
export type LibraryItemKind = "work_product" | "document" | "attachment";

export interface LibraryItem {
  kind: LibraryItemKind;
  id: string;
  title: string;
  subtitle: string | null;
  issueId: string;
  issueTitle: string | null;
  issueIdentifier: string | null;
  url: string | null;
  contentType: string | null;
  byteSize: number | null;
  updatedAt: string;
  createdAt: string;
  extra: Record<string, unknown>;
}

function toIsoString(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

export function libraryService(db: Db) {
  return {
    async listForCompany(companyId: string, opts: { limit?: number } = {}): Promise<LibraryItem[]> {
      const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));

      const workProductRows = await db
        .select({
          id: issueWorkProducts.id,
          issueId: issueWorkProducts.issueId,
          title: issueWorkProducts.title,
          summary: issueWorkProducts.summary,
          url: issueWorkProducts.url,
          type: issueWorkProducts.type,
          provider: issueWorkProducts.provider,
          status: issueWorkProducts.status,
          isPrimary: issueWorkProducts.isPrimary,
          createdAt: issueWorkProducts.createdAt,
          updatedAt: issueWorkProducts.updatedAt,
          issueTitle: issues.title,
          issueIdentifier: issues.identifier,
        })
        .from(issueWorkProducts)
        .leftJoin(issues, eq(issues.id, issueWorkProducts.issueId))
        .where(eq(issueWorkProducts.companyId, companyId))
        .orderBy(desc(issueWorkProducts.updatedAt))
        .limit(limit);

      const documentRows = await db
        .select({
          id: issueDocuments.id,
          issueId: issueDocuments.issueId,
          documentId: issueDocuments.documentId,
          key: issueDocuments.key,
          title: documents.title,
          format: documents.format,
          createdAt: issueDocuments.createdAt,
          updatedAt: issueDocuments.updatedAt,
          issueTitle: issues.title,
          issueIdentifier: issues.identifier,
        })
        .from(issueDocuments)
        .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
        .leftJoin(issues, eq(issues.id, issueDocuments.issueId))
        .where(eq(issueDocuments.companyId, companyId))
        .orderBy(desc(issueDocuments.updatedAt))
        .limit(limit);

      const attachmentRows = await db
        .select({
          id: issueAttachments.id,
          issueId: issueAttachments.issueId,
          assetId: issueAttachments.assetId,
          issueCommentId: issueAttachments.issueCommentId,
          commentBody: issueComments.body,
          originalFilename: assets.originalFilename,
          contentType: assets.contentType,
          byteSize: assets.byteSize,
          provider: assets.provider,
          objectKey: assets.objectKey,
          createdAt: issueAttachments.createdAt,
          updatedAt: issueAttachments.updatedAt,
          issueTitle: issues.title,
          issueIdentifier: issues.identifier,
        })
        .from(issueAttachments)
        .innerJoin(assets, eq(assets.id, issueAttachments.assetId))
        .leftJoin(issueComments, eq(issueComments.id, issueAttachments.issueCommentId))
        .leftJoin(issues, eq(issues.id, issueAttachments.issueId))
        .where(eq(issueAttachments.companyId, companyId))
        .orderBy(desc(issueAttachments.updatedAt))
        .limit(limit);

      const workItems: LibraryItem[] = workProductRows.map((row) => ({
        kind: "work_product",
        id: row.id,
        title: row.title,
        subtitle: row.summary ?? `${row.type} · ${row.provider}`,
        issueId: row.issueId,
        issueTitle: row.issueTitle ?? null,
        issueIdentifier: row.issueIdentifier ?? null,
        url: row.url ?? null,
        contentType: null,
        byteSize: null,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        extra: {
          type: row.type,
          provider: row.provider,
          status: row.status,
          isPrimary: row.isPrimary,
        },
      }));

      const documentItems: LibraryItem[] = documentRows.map((row) => ({
        kind: "document",
        id: row.id,
        title: row.title || row.key,
        subtitle: row.key,
        issueId: row.issueId,
        issueTitle: row.issueTitle ?? null,
        issueIdentifier: row.issueIdentifier ?? null,
        url: null,
        contentType: row.format ?? "markdown",
        byteSize: null,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        extra: {
          documentId: row.documentId,
          key: row.key,
        },
      }));

      const attachmentItems: LibraryItem[] = attachmentRows.map((row) => ({
        kind: "attachment",
        id: row.id,
        title: row.originalFilename ?? "Untitled attachment",
        subtitle:
          row.commentBody && row.commentBody.length > 0
            ? row.commentBody.slice(0, 120)
            : row.contentType,
        issueId: row.issueId,
        issueTitle: row.issueTitle ?? null,
        issueIdentifier: row.issueIdentifier ?? null,
        url: `/api/assets/${row.assetId}/content`,
        contentType: row.contentType,
        byteSize: row.byteSize ?? null,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        extra: {
          assetId: row.assetId,
          provider: row.provider,
          issueCommentId: row.issueCommentId ?? null,
        },
      }));

      const merged = [...workItems, ...documentItems, ...attachmentItems];
      merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      return merged.slice(0, limit);
    },
  };
}

export type LibraryService = ReturnType<typeof libraryService>;
