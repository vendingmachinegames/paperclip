import { describe, expect, it } from "vitest";
import {
  applyCompanySlug,
  extractCompanySlugFromPath,
  isBoardPathWithoutPrefix,
  normalizeCompanySlug,
  toCompanyRelativePath,
} from "./company-routes";

describe("company routes", () => {
  it("treats execution workspace paths as board routes that need a company slug", () => {
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123/issues")).toBe(true);
    expect(extractCompanySlugFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applyCompanySlug("/execution-workspaces/workspace-123", "acme")).toBe(
      "/acme/execution-workspaces/workspace-123",
    );
    expect(applyCompanySlug("/execution-workspaces/workspace-123/issues", "acme")).toBe(
      "/acme/execution-workspaces/workspace-123/issues",
    );
  });

  it("normalizes prefixed execution workspace paths back to company-relative paths", () => {
    expect(toCompanyRelativePath("/acme/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
    expect(toCompanyRelativePath("/acme/execution-workspaces/workspace-123/configuration")).toBe(
      "/execution-workspaces/workspace-123/configuration",
    );
  });

  /**
   * Regression tests for https://github.com/paperclipai/paperclip/issues/2910
   *
   * The Export and Import links on the Company Settings page used plain
   * `<a href="/company/export">` anchors which bypass the router's Link
   * wrapper. Without the wrapper, the company slug is never applied and
   * the links resolve to `/company/export` instead of `/:slug/company/export`,
   * producing a "Company not found" error.
   *
   * The fix replaces the `<a>` elements with the slug-aware `<Link>` from
   * `@/lib/router`. These tests assert that the underlying `applyCompanySlug`
   * utility (used by that Link) correctly rewrites the export/import paths.
   */
  it("applies company slug to /company/export", () => {
    expect(applyCompanySlug("/company/export", "acme")).toBe("/acme/company/export");
  });

  it("applies company slug to /company/import", () => {
    expect(applyCompanySlug("/company/import", "acme")).toBe("/acme/company/import");
  });

  it("does not double-apply the slug if already present", () => {
    expect(applyCompanySlug("/acme/company/export", "acme")).toBe("/acme/company/export");
  });

  it("lowercases slug input during normalization", () => {
    expect(normalizeCompanySlug("  Acme-Robotics  ")).toBe("acme-robotics");
  });

  it("extracts slugs case-insensitively (legacy uppercase URLs still resolve)", () => {
    expect(extractCompanySlugFromPath("/ACME/dashboard")).toBe("acme");
  });
});
