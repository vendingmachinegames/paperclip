type OnboardingRouteCompany = {
  id: string;
  slug: string;
};

export function isOnboardingPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 1) {
    return segments[0]?.toLowerCase() === "onboarding";
  }

  if (segments.length === 2) {
    return segments[1]?.toLowerCase() === "onboarding";
  }

  return false;
}

export function resolveRouteOnboardingOptions(params: {
  pathname: string;
  companySlug?: string;
  companies: OnboardingRouteCompany[];
}): { initialStep: 1 | 2; companyId?: string } | null {
  const { pathname, companySlug, companies } = params;

  if (!isOnboardingPath(pathname)) return null;

  if (!companySlug) {
    return { initialStep: 1 };
  }

  const normalized = companySlug.toLowerCase();
  const matchedCompany =
    companies.find((company) => company.slug.toLowerCase() === normalized) ?? null;

  if (!matchedCompany) {
    return { initialStep: 1 };
  }

  return { initialStep: 2, companyId: matchedCompany.id };
}

export function shouldRedirectCompanylessRouteToOnboarding(params: {
  pathname: string;
  hasCompanies: boolean;
}): boolean {
  return !params.hasCompanies && !isOnboardingPath(params.pathname);
}
