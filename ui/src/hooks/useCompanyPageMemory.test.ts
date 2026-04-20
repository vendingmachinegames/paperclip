import { describe, expect, it } from "vitest";
import {
  getRememberedPathOwnerCompanyId,
  sanitizeRememberedPathForCompany,
} from "../lib/company-page-memory";

const companies = [
  { id: "for", slug: "for" },
  { id: "pap", slug: "pap" },
];

describe("getRememberedPathOwnerCompanyId", () => {
  it("uses the route company instead of stale selected-company state for slug-prefixed routes", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: "/for/issues/FOR-1",
        fallbackCompanyId: "pap",
      }),
    ).toBe("for");
  });

  it("matches legacy uppercase URLs by lowercasing the slug segment", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: "/FOR/issues/FOR-1",
        fallbackCompanyId: "pap",
      }),
    ).toBe("for");
  });

  it("skips saving when a slug-prefixed route cannot yet be resolved to a known company", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies: [],
        pathname: "/for/issues/FOR-1",
        fallbackCompanyId: "pap",
      }),
    ).toBeNull();
  });

  it("falls back to the previous company for unprefixed board routes", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: "/dashboard",
        fallbackCompanyId: "pap",
      }),
    ).toBe("pap");
  });

  it("treats unprefixed skills routes as board routes instead of company slugs", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: "/skills/skill-123/files/SKILL.md",
        fallbackCompanyId: "pap",
      }),
    ).toBe("pap");
  });
});

describe("sanitizeRememberedPathForCompany", () => {
  it("keeps remembered issue paths that belong to the target company", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: "/issues/PAP-12",
        companyIssuePrefix: "PAP",
      }),
    ).toBe("/issues/PAP-12");
  });

  it("falls back to dashboard for remembered issue identifiers from another company", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: "/issues/FOR-1",
        companyIssuePrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("falls back to dashboard when no remembered path exists", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: null,
        companyIssuePrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("keeps remembered skills paths intact for the target company", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: "/skills/skill-123/files/SKILL.md",
        companyIssuePrefix: "PAP",
      }),
    ).toBe("/skills/skill-123/files/SKILL.md");
  });
});
