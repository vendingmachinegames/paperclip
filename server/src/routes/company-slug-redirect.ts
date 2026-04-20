import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, companySlugRedirects } from "@paperclipai/db";
import { COMPANY_SLUG_RESERVED } from "@paperclipai/shared";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Intercepts GET requests whose first path segment is a retired company
 * slug and 302s them to the current canonical slug. Reserved segments
 * (dashboard, api, assets, etc.) and unknown-but-unregistered segments
 * pass through untouched — the SPA handles them.
 */
export function companySlugRedirectMiddleware(db: Db): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const segments = req.path.split("/").filter(Boolean);
    if (segments.length === 0) return next();

    const first = segments[0]!.toLowerCase();
    if (COMPANY_SLUG_RESERVED.has(first)) return next();
    if (!SLUG_PATTERN.test(first)) return next();

    // Live slug: let the SPA handle it.
    const liveMatch = await db
      .select({ slug: companies.slug })
      .from(companies)
      .where(eq(companies.slug, first))
      .limit(1);
    if (liveMatch.length > 0) return next();

    // Retired slug: resolve and redirect.
    const redirectMatch = await db
      .select({ companyId: companySlugRedirects.companyId })
      .from(companySlugRedirects)
      .where(eq(companySlugRedirects.oldSlug, first))
      .limit(1);
    if (redirectMatch.length === 0) return next();

    const [current] = await db
      .select({ slug: companies.slug })
      .from(companies)
      .where(eq(companies.id, redirectMatch[0]!.companyId))
      .limit(1);
    if (!current) return next();

    // Preserve remaining path and any query string / hash.
    const rest = segments.slice(1).join("/");
    const query = req.originalUrl.slice(req.path.length);
    const target = `/${current.slug}${rest ? `/${rest}` : ""}${query}`;
    res.redirect(302, target);
  };
}

// Re-exported for callers that want the matcher without the middleware
// (e.g. the resolver endpoint).
export async function resolveSlugToCurrent(
  db: Db,
  slug: string,
): Promise<{ companyId: string; canonicalSlug: string; redirected: boolean } | null> {
  const normalized = slug.toLowerCase();
  const live = await db
    .select({ id: companies.id, slug: companies.slug })
    .from(companies)
    .where(eq(companies.slug, normalized))
    .limit(1);
  if (live.length > 0) {
    return { companyId: live[0]!.id, canonicalSlug: live[0]!.slug, redirected: false };
  }
  const redir = await db
    .select({ companyId: companySlugRedirects.companyId })
    .from(companySlugRedirects)
    .where(eq(companySlugRedirects.oldSlug, normalized))
    .limit(1);
  if (redir.length === 0) return null;
  const current = await db
    .select({ id: companies.id, slug: companies.slug })
    .from(companies)
    .where(eq(companies.id, redir[0]!.companyId))
    .limit(1);
  if (current.length === 0) return null;
  return { companyId: current[0]!.id, canonicalSlug: current[0]!.slug, redirected: true };
}

