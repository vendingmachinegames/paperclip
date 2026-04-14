import {
  extractCompanySlugFromPath,
  normalizeCompanySlug,
  toCompanyRelativePath,
} from "./company-routes";

const GLOBAL_SEGMENTS = new Set(["auth", "invite", "board-claim", "cli-auth", "docs"]);

export function isRememberableCompanyPath(path: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  const [root] = segments;
  if (GLOBAL_SEGMENTS.has(root!)) return false;
  return true;
}

function findCompanyBySlug<T extends { id: string; slug: string }>(params: {
  companies: T[];
  companySlug: string;
}): T | null {
  const normalized = normalizeCompanySlug(params.companySlug);
  return params.companies.find((company) => normalizeCompanySlug(company.slug) === normalized) ?? null;
}

export function getRememberedPathOwnerCompanyId<T extends { id: string; slug: string }>(params: {
  companies: T[];
  pathname: string;
  fallbackCompanyId: string | null;
}): string | null {
  const routeCompanySlug = extractCompanySlugFromPath(params.pathname);
  if (!routeCompanySlug) {
    return params.fallbackCompanyId;
  }

  return findCompanyBySlug({
    companies: params.companies,
    companySlug: routeCompanySlug,
  })?.id ?? null;
}

export function sanitizeRememberedPathForCompany(params: {
  path: string | null | undefined;
  /** Ticket-key prefix (e.g. "ACME"); used to drop cross-company ticket paths. */
  companyIssuePrefix: string;
}): string {
  const relativePath = params.path ? toCompanyRelativePath(params.path) : "/dashboard";
  if (!isRememberableCompanyPath(relativePath)) {
    return "/dashboard";
  }

  const pathname = relativePath.split("?")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  const [root, entityId] = segments;
  if (root === "issues" && entityId) {
    const identifierMatch = /^([A-Za-z]+)-\d+$/.exec(entityId);
    if (
      identifierMatch &&
      (identifierMatch[1] ?? "").toUpperCase() !== params.companyIssuePrefix.toUpperCase()
    ) {
      return "/dashboard";
    }
  }

  return relativePath;
}
