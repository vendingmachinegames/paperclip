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
import { seedOnboardingCeo } from "../services/onboarding-ceo.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping onboarding-ceo tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("seedOnboardingCeo()", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-onboarding-ceo-");
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

  async function freshCompanyWithBoardroom() {
    const company = await companyService(db).create({ name: "Acme", draft: true });
    const room = await boardroomService(db).getOrCreate(company.id);
    return { company, room };
  }

  it("creates a CEO agent paused for adapter setup", async () => {
    const { company, room } = await freshCompanyWithBoardroom();
    const { ceo } = await seedOnboardingCeo({
      db,
      companyId: company.id,
      boardroomIssueId: room.id,
    });

    expect(ceo.name).toBe("CEO");
    expect(ceo.role).toBe("ceo");
    expect(ceo.status).toBe("paused");
    expect(ceo.pauseReason).toBe("manual");
    expect(ceo.adapterType).toBe("claude_local");
    expect(ceo.companyId).toBe(company.id);
  });

  it("posts a welcome comment authored by the CEO into the Boardroom", async () => {
    const { company, room } = await freshCompanyWithBoardroom();
    const { ceo } = await seedOnboardingCeo({
      db,
      companyId: company.id,
      boardroomIssueId: room.id,
    });

    const comments = await db
      .select()
      .from(issueComments)
      .where(and(eq(issueComments.issueId, room.id)));

    expect(comments).toHaveLength(1);
    expect(comments[0]!.authorAgentId).toBe(ceo.id);
    expect(comments[0]!.authorUserId).toBeNull();
    expect(comments[0]!.body).toMatch(/Welcome to the Boardroom/i);
    expect(comments[0]!.body).toMatch(/office-hours/i);
  });

  it("scopes to its own company — other companies are untouched", async () => {
    const a = await companyService(db).create({ name: "Alpha", draft: true });
    const b = await companyService(db).create({ name: "Bravo", draft: true });
    const roomA = await boardroomService(db).getOrCreate(a.id);
    const roomB = await boardroomService(db).getOrCreate(b.id);

    await seedOnboardingCeo({ db, companyId: a.id, boardroomIssueId: roomA.id });

    const agentsA = await db.select().from(agents).where(eq(agents.companyId, a.id));
    const agentsB = await db.select().from(agents).where(eq(agents.companyId, b.id));
    expect(agentsA).toHaveLength(1);
    expect(agentsB).toHaveLength(0);

    const commentsA = await db.select().from(issueComments).where(eq(issueComments.issueId, roomA.id));
    const commentsB = await db.select().from(issueComments).where(eq(issueComments.issueId, roomB.id));
    expect(commentsA).toHaveLength(1);
    expect(commentsB).toHaveLength(0);
  });
});
