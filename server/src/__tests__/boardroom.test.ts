import { and, eq } from "drizzle-orm";
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
import { boardroomService } from "../services/boardroom.js";
import { companyService } from "../services/companies.js";
import { dashboardService } from "../services/dashboard.js";
import { issueService } from "../services/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping boardroom tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("boardroom service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-boardroom-");
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

  describe("getOrCreate()", () => {
    it("creates a Boardroom conversation issue for a company", async () => {
      const svc = companyService(db);
      const company = await svc.create({ name: "Acme" });

      const boardroom = boardroomService(db);
      const issue = await boardroom.getOrCreate(company.id);

      expect(issue.kind).toBe("conversation");
      expect(issue.title).toBe("Boardroom");
      expect(issue.companyId).toBe(company.id);
      expect(issue.projectId).toBeNull();
      expect(issue.goalId).toBeNull();
      expect(issue.assigneeAgentId).toBeNull();
      expect(issue.identifier).toBeNull();
      expect(issue.issueNumber).toBeNull();
    });

    it("is idempotent — returns the same row on repeat calls", async () => {
      const svc = companyService(db);
      const company = await svc.create({ name: "Acme" });
      const boardroom = boardroomService(db);

      const first = await boardroom.getOrCreate(company.id);
      const second = await boardroom.getOrCreate(company.id);
      expect(first.id).toBe(second.id);

      const rows = await db
        .select()
        .from(issues)
        .where(and(eq(issues.companyId, company.id), eq(issues.kind, "conversation")));
      expect(rows).toHaveLength(1);
    });

    it("scopes per-company — each company gets its own Boardroom", async () => {
      const svc = companyService(db);
      const a = await svc.create({ name: "Alpha" });
      const b = await svc.create({ name: "Bravo" });
      const boardroom = boardroomService(db);

      const roomA = await boardroom.getOrCreate(a.id);
      const roomB = await boardroom.getOrCreate(b.id);
      expect(roomA.id).not.toBe(roomB.id);
      expect(roomA.companyId).toBe(a.id);
      expect(roomB.companyId).toBe(b.id);
    });
  });

  describe("query filters exclude conversations", () => {
    it("issueService.list() does not return the Boardroom", async () => {
      const companySvc = companyService(db);
      const boardroom = boardroomService(db);
      const issueSvc = issueService(db);

      const company = await companySvc.create({ name: "Acme" });
      await boardroom.getOrCreate(company.id);
      // Add a real task so the list isn't empty
      await db.insert(issues).values({
        companyId: company.id,
        kind: "task",
        title: "Real work",
        status: "todo",
      });

      const listed = await issueSvc.list(company.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.title).toBe("Real work");
    });

    it("countUnreadTouchedByUser does not count the Boardroom", async () => {
      const companySvc = companyService(db);
      const boardroom = boardroomService(db);
      const issueSvc = issueService(db);

      const company = await companySvc.create({ name: "Acme" });
      const room = await boardroom.getOrCreate(company.id);
      // Touch the boardroom comment to simulate activity
      await db.insert(issueComments).values({
        companyId: company.id,
        issueId: room.id,
        authorUserId: "user-1",
        body: "hello",
      });

      const count = await issueSvc.countUnreadTouchedByUser(company.id, "user-1");
      expect(count).toBe(0);
    });

    it("dashboard task counts do not include conversation issues", async () => {
      const companySvc = companyService(db);
      const boardroom = boardroomService(db);
      const dashboard = dashboardService(db);

      const company = await companySvc.create({ name: "Acme" });
      await boardroom.getOrCreate(company.id);
      // One real task in todo so task count = 1 if filter works
      await db.insert(issues).values({
        companyId: company.id,
        kind: "task",
        title: "Real work",
        status: "todo",
      });

      const summary = await dashboard.summary(company.id);
      // Whatever the bucket name for todo is, the total should be 1 (only
      // the real task), never 2 (task + Boardroom).
      const totalTasks = Object.values(summary.tasks).reduce(
        (sum, n) => sum + (typeof n === "number" ? n : 0),
        0,
      );
      expect(totalTasks).toBe(1);
    });
  });
});
