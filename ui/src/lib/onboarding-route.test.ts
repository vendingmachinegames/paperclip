import { describe, expect, it } from "vitest";
import {
  isOnboardingPath,
  resolveRouteOnboardingOptions,
  shouldRedirectCompanylessRouteToOnboarding,
} from "./onboarding-route";

describe("isOnboardingPath", () => {
  it("matches the global onboarding route", () => {
    expect(isOnboardingPath("/onboarding")).toBe(true);
  });

  it("matches a company-scoped onboarding route", () => {
    expect(isOnboardingPath("/acme/onboarding")).toBe(true);
  });

  it("ignores non-onboarding routes", () => {
    expect(isOnboardingPath("/acme/dashboard")).toBe(false);
  });
});

describe("resolveRouteOnboardingOptions", () => {
  it("opens company creation for the global onboarding route", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/onboarding",
        companies: [],
      }),
    ).toEqual({ initialStep: 1 });
  });

  it("opens agent creation when the slug-matched company exists", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/acme/onboarding",
        companySlug: "acme",
        companies: [{ id: "company-1", slug: "acme" }],
      }),
    ).toEqual({ initialStep: 2, companyId: "company-1" });
  });

  it("matches case-insensitively so legacy uppercase URLs still resolve", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/ACME/onboarding",
        companySlug: "ACME",
        companies: [{ id: "company-1", slug: "acme" }],
      }),
    ).toEqual({ initialStep: 2, companyId: "company-1" });
  });

  it("falls back to company creation when the slug-matched company is missing", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/acme/onboarding",
        companySlug: "acme",
        companies: [],
      }),
    ).toEqual({ initialStep: 1 });
  });
});

describe("shouldRedirectCompanylessRouteToOnboarding", () => {
  it("redirects companyless entry routes into onboarding", () => {
    expect(
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: "/",
        hasCompanies: false,
      }),
    ).toBe(true);
  });

  it("does not redirect when already on onboarding", () => {
    expect(
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: "/onboarding",
        hasCompanies: false,
      }),
    ).toBe(false);
  });

  it("does not redirect when companies exist", () => {
    expect(
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: "/issues",
        hasCompanies: true,
      }),
    ).toBe(false);
  });
});
