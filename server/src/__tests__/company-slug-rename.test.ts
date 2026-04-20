import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companySlugRedirects,
  createDb,
  issueComments,
  issueReadStates,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyService } from "../services/companies.js";
import { companySlugRedirectMiddleware } from "../routes/company-slug-redirect.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping company slug rename tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("company slug + rename", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-slug-rename-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueReadStates);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companySlugRedirects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  describe("create()", () => {
    it("derives a kebab-case slug from the company name", async () => {
      const svc = companyService(db);
      const company = await svc.create({ name: "Acme Robotics, Inc." });
      expect(company.slug).toBe("acme-robotics-inc");
      expect(company.isDraft).toBe(false);
    });

    it("generates a draft-<nano> slug when draft: true", async () => {
      const svc = companyService(db);
      const company = await svc.create({ name: "Untitled Company", draft: true });
      expect(company.slug).toMatch(/^draft-[a-z0-9]{6}$/);
      expect(company.isDraft).toBe(true);
    });

    it("suffixes a conflicting non-draft slug instead of failing", async () => {
      const svc = companyService(db);
      const first = await svc.create({ name: "Acme" });
      const second = await svc.create({ name: "Acme" });
      expect(first.slug).toBe("acme");
      expect(second.slug).toBe("acme-2");
    });
  });

  describe("update() slug changes", () => {
    it("writes the retired slug to company_slug_redirects", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Draft", draft: true });
      const originalSlug = created.slug;

      const renamed = await svc.update(created.id, { slug: "acme-robotics" });
      expect(renamed?.slug).toBe("acme-robotics");

      const redirects = await db
        .select()
        .from(companySlugRedirects)
        .where(eq(companySlugRedirects.oldSlug, originalSlug));
      expect(redirects).toHaveLength(1);
      expect(redirects[0]!.companyId).toBe(created.id);
    });

    it("records each slug in history when the company is renamed multiple times", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      const first = created.slug;

      const second = await svc.update(created.id, { slug: "bravo" });
      expect(second?.slug).toBe("bravo");
      const third = await svc.update(created.id, { slug: "charlie" });
      expect(third?.slug).toBe("charlie");

      const redirects = await db
        .select()
        .from(companySlugRedirects)
        .where(eq(companySlugRedirects.companyId, created.id));
      const oldSlugs = redirects.map((r) => r.oldSlug).sort();
      expect(oldSlugs).toEqual([first, "bravo"].sort());
    });

    it("clears a conflicting redirect when reclaiming a slug", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      // acme -> bravo (acme becomes a redirect)
      await svc.update(created.id, { slug: "bravo" });
      // bravo -> acme (acme reclaimed; the old redirect would now shadow
      // the new canonical if we didn't clear it)
      const reclaimed = await svc.update(created.id, { slug: "acme" });
      expect(reclaimed?.slug).toBe("acme");

      const staleRedirect = await db
        .select()
        .from(companySlugRedirects)
        .where(eq(companySlugRedirects.oldSlug, "acme"));
      expect(staleRedirect).toHaveLength(0);
    });

    it("rejects a slug already held by another company", async () => {
      const svc = companyService(db);
      const first = await svc.create({ name: "Acme" });
      const second = await svc.create({ name: "Bravo" });

      await expect(svc.update(second.id, { slug: first.slug })).rejects.toThrow(/already in use/);
    });

    it("does not write a redirect when slug is unchanged", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      await svc.update(created.id, { slug: created.slug, description: "touch" });

      const redirects = await db
        .select()
        .from(companySlugRedirects)
        .where(eq(companySlugRedirects.companyId, created.id));
      expect(redirects).toHaveLength(0);
    });
  });

  describe("getBySlug()", () => {
    it("resolves a live slug with redirected=false", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      const found = await svc.getBySlug("acme");
      expect(found?.company.id).toBe(created.id);
      expect(found?.redirected).toBe(false);
    });

    it("resolves a retired slug with redirected=true", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      await svc.update(created.id, { slug: "bravo" });
      const found = await svc.getBySlug("acme");
      expect(found?.company.id).toBe(created.id);
      expect(found?.company.slug).toBe("bravo");
      expect(found?.redirected).toBe(true);
    });

    it("returns null for an unknown slug", async () => {
      const svc = companyService(db);
      expect(await svc.getBySlug("ghost")).toBeNull();
    });

    it("normalizes case", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      const found = await svc.getBySlug("ACME");
      expect(found?.company.id).toBe(created.id);
    });
  });

  describe("redirect middleware", () => {
    function makeApp() {
      const app = express();
      app.use(companySlugRedirectMiddleware(db));
      app.get(/.*/, (_req, res) => {
        res.status(200).send("spa");
      });
      return app;
    }

    it("302s retired slug paths to the current canonical slug", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      await svc.update(created.id, { slug: "bravo" });

      const app = makeApp();
      const res = await request(app).get("/acme/dashboard");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/bravo/dashboard");
    });

    it("preserves query string and deeper path segments on redirect", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      await svc.update(created.id, { slug: "bravo" });

      const app = makeApp();
      const res = await request(app).get("/acme/issues/ACME-42?tab=comments");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/bravo/issues/ACME-42?tab=comments");
    });

    it("passes through live slugs untouched", async () => {
      const svc = companyService(db);
      await svc.create({ name: "Acme" });

      const app = makeApp();
      const res = await request(app).get("/acme/dashboard");
      expect(res.status).toBe(200);
      expect(res.text).toBe("spa");
    });

    it("passes through reserved segments untouched", async () => {
      const app = makeApp();
      for (const reserved of ["/dashboard", "/api/health", "/auth/login", "/chat"]) {
        const res = await request(app).get(reserved);
        expect(res.status).toBe(200);
      }
    });

    it("passes through unknown non-slug segments untouched", async () => {
      const app = makeApp();
      const res = await request(app).get("/never-existed");
      expect(res.status).toBe(200);
    });

    it("ignores non-GET methods", async () => {
      const svc = companyService(db);
      const created = await svc.create({ name: "Acme" });
      await svc.update(created.id, { slug: "bravo" });

      const app = makeApp();
      app.post(/.*/, (_req, res) => res.status(200).send("post"));
      const res = await request(app).post("/acme/foo");
      expect(res.status).toBe(200);
      expect(res.text).toBe("post");
    });
  });
});
