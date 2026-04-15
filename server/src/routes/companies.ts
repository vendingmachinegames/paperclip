import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION,
  companyPortabilityExportSchema,
  companyPortabilityImportSchema,
  companyPortabilityPreviewSchema,
  createCompanySchema,
  createDraftCompanySchema,
  feedbackTargetTypeSchema,
  feedbackTraceStatusSchema,
  feedbackVoteValueSchema,
  updateCompanyBrandingSchema,
  updateCompanySchema,
} from "@paperclipai/shared";
import { badRequest, forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  agentService,
  boardroomService,
  boardroomCardsService,
  budgetService,
  companyPortabilityService,
  companyService,
  feedbackService,
  issueService,
  libraryService,
  logActivity,
  seedOnboardingCeo,
} from "../services/index.js";
import { AGENT_ADAPTER_TYPES, AGENT_ROLES } from "@paperclipai/shared";
import type { StorageService } from "../storage/types.js";
import { assertBoard, assertCompanyAccess, assertInstanceAdmin, getActorInfo } from "./authz.js";

export function companyRoutes(db: Db, storage?: StorageService) {
  const router = Router();
  const svc = companyService(db);
  const agents = agentService(db);
  const boardroom = boardroomService(db);
  const portability = companyPortabilityService(db, storage);
  const access = accessService(db);
  const budgets = budgetService(db);
  const feedback = feedbackService(db);

  function parseBooleanQuery(value: unknown) {
    return value === true || value === "true" || value === "1";
  }

  function parseDateQuery(value: unknown, field: string) {
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw badRequest(`Invalid ${field} query value`);
    }
    return parsed;
  }

  function assertImportTargetAccess(
    req: Request,
    target: { mode: "new_company" } | { mode: "existing_company"; companyId: string },
  ) {
    if (target.mode === "new_company") {
      assertInstanceAdmin(req);
      return;
    }
    assertCompanyAccess(req, target.companyId);
  }

  async function assertCanUpdateBranding(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return;
    if (!req.actor.agentId) throw forbidden("Agent authentication required");

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }
    if (actorAgent.role !== "ceo") {
      throw forbidden("Only CEO agents can update company branding");
    }
  }

  async function assertCanManagePortability(req: Request, companyId: string, capability: "imports" | "exports") {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return;
    if (!req.actor.agentId) throw forbidden("Agent authentication required");

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }
    if (actorAgent.role !== "ceo") {
      throw forbidden(`Only CEO agents can manage company ${capability}`);
    }
  }

  router.get("/", async (req, res) => {
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(result);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(result.filter((company) => allowed.has(company.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      ? null
      : new Set(req.actor.companyIds ?? []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([companyId]) => allowed.has(companyId)));
    res.json(filtered);
  });

  // Common malformed path when companyId is empty in "/api/companies/{companyId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });

  router.get("/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    // Allow agents (CEO) to read their own company; board always allowed
    if (req.actor.type !== "agent") {
      assertBoard(req);
    }
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(company);
  });

  router.get("/:companyId/feedback-traces", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);

    const targetTypeRaw = typeof req.query.targetType === "string" ? req.query.targetType : undefined;
    const voteRaw = typeof req.query.vote === "string" ? req.query.vote : undefined;
    const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
    const issueId = typeof req.query.issueId === "string" && req.query.issueId.trim().length > 0 ? req.query.issueId : undefined;
    const projectId = typeof req.query.projectId === "string" && req.query.projectId.trim().length > 0
      ? req.query.projectId
      : undefined;

    const traces = await feedback.listFeedbackTraces({
      companyId,
      issueId,
      projectId,
      targetType: targetTypeRaw ? feedbackTargetTypeSchema.parse(targetTypeRaw) : undefined,
      vote: voteRaw ? feedbackVoteValueSchema.parse(voteRaw) : undefined,
      status: statusRaw ? feedbackTraceStatusSchema.parse(statusRaw) : undefined,
      from: parseDateQuery(req.query.from, "from"),
      to: parseDateQuery(req.query.to, "to"),
      sharedOnly: parseBooleanQuery(req.query.sharedOnly),
      includePayload: parseBooleanQuery(req.query.includePayload),
    });
    res.json(traces);
  });

  router.post("/:companyId/export", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    assertBoard(req);
    assertImportTargetAccess(req, req.body.target);
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.post("/import", validate(companyPortabilityImportSchema), async (req, res) => {
    assertBoard(req);
    assertImportTargetAccess(req, req.body.target);
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null);
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.imported",
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
      },
    });
    res.json(result);
  });

  router.post("/:companyId/exports/preview", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "exports");
    const preview = await portability.previewExport(companyId, req.body);
    res.json(preview);
  });

  router.post("/:companyId/exports", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "exports");
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/:companyId/imports/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "imports");
    if (req.body.target.mode === "existing_company" && req.body.target.companyId !== companyId) {
      throw forbidden("Safe import route can only target the route company");
    }
    if (req.body.collisionStrategy === "replace") {
      throw forbidden("Safe import route does not allow replace collision strategy");
    }
    const preview = await portability.previewImport(req.body, {
      mode: "agent_safe",
      sourceCompanyId: companyId,
    });
    res.json(preview);
  });

  router.post("/:companyId/imports/apply", validate(companyPortabilityImportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "imports");
    if (req.body.target.mode === "existing_company" && req.body.target.companyId !== companyId) {
      throw forbidden("Safe import route can only target the route company");
    }
    if (req.body.collisionStrategy === "replace") {
      throw forbidden("Safe import route does not allow replace collision strategy");
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null, {
      mode: "agent_safe",
      sourceCompanyId: companyId,
    });
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.imported",
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
        importMode: "agent_safe",
      },
    });
    res.json(result);
  });

  router.post("/", validate(createCompanySchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    const company = await svc.create(req.body);
    await access.ensureMembership(company.id, "user", req.actor.userId ?? "local-board", "owner", "active");
    await boardroom.getOrCreate(company.id);
    await logActivity(db, {
      companyId: company.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      details: { name: company.name },
    });
    if (company.budgetMonthlyCents > 0) {
      await budgets.upsertPolicy(
        company.id,
        {
          scopeType: "company",
          scopeId: company.id,
          amount: company.budgetMonthlyCents,
          windowKind: "calendar_month_utc",
        },
        req.actor.userId ?? "board",
      );
    }
    res.status(201).json(company);
  });

  router.get("/:companyId/boardroom", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    const issue = await boardroom.getOrCreate(companyId);
    res.json({ boardroom: issue });
  });

  const cardsSvc = boardroomCardsService(db);
  const library = libraryService(db);

  router.get("/:companyId/library", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const limitRaw = req.query.limit;
    const limit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : undefined;
    const items = await library.listForCompany(companyId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ items });
  });

  router.get("/:companyId/boardroom/cards", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const issue = await boardroom.getOrCreate(companyId);
    const cards = await cardsSvc.listForIssue(issue.id);
    res.json({ cards });
  });

  async function loadCardForCompany(companyId: string, cardId: string) {
    const card = await cardsSvc.getById(cardId);
    if (!card || card.companyId !== companyId) return null;
    return card;
  }

  router.post("/:companyId/boardroom/cards/:cardId/accept", async (req, res) => {
    const companyId = req.params.companyId as string;
    const cardId = req.params.cardId as string;
    assertCompanyAccess(req, companyId);

    const card = await loadCardForCompany(companyId, cardId);
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    if (card.state !== "pending") {
      res.status(200).json({ card });
      return;
    }

    const actorUserId = req.actor.userId ?? "local-board";
    let resultPayload: Record<string, unknown> = {};

    try {
      if (card.kind === "hire_proposal") {
        resultPayload = await acceptHireProposal(card);
      } else if (card.kind === "task_completion") {
        resultPayload = await acceptTaskCompletion(card);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to accept card";
      res.status(422).json({ error: message });
      return;
    }

    const updated = await cardsSvc.resolve({
      id: card.id,
      nextState: "accepted",
      resolvedByUserId: actorUserId,
      resultPayload,
    });

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: actorUserId,
      action: "boardroom_card.accepted",
      entityType: "boardroom_card",
      entityId: card.id,
      details: { kind: card.kind, resultPayload },
    });

    res.json({ card: updated });
  });

  router.post("/:companyId/boardroom/cards/:cardId/reject", async (req, res) => {
    const companyId = req.params.companyId as string;
    const cardId = req.params.cardId as string;
    assertCompanyAccess(req, companyId);

    const card = await loadCardForCompany(companyId, cardId);
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    if (card.state !== "pending") {
      res.json({ card });
      return;
    }

    const actorUserId = req.actor.userId ?? "local-board";
    const updated = await cardsSvc.resolve({
      id: card.id,
      nextState: "rejected",
      resolvedByUserId: actorUserId,
    });

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: actorUserId,
      action: "boardroom_card.rejected",
      entityType: "boardroom_card",
      entityId: card.id,
      details: { kind: card.kind },
    });

    res.json({ card: updated });
  });

  async function acceptHireProposal(card: Awaited<ReturnType<typeof cardsSvc.getById>>): Promise<Record<string, unknown>> {
    if (!card) throw new Error("Card not found");
    const payload = card.payload ?? {};
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) throw new Error("hire_proposal payload missing `name`");

    const roleRaw = typeof payload.role === "string" ? payload.role.trim() : "general";
    const role = (AGENT_ROLES as readonly string[]).includes(roleRaw) ? roleRaw : "general";

    const adapterRaw = typeof payload.adapterType === "string" ? payload.adapterType.trim() : "claude_local";
    const adapterType = (AGENT_ADAPTER_TYPES as readonly string[]).includes(adapterRaw) ? adapterRaw : "claude_local";

    const title = typeof payload.title === "string" ? payload.title : null;
    const icon = typeof payload.icon === "string" ? payload.icon : null;
    const reportsTo = typeof payload.reportsTo === "string" ? payload.reportsTo : null;
    const description = typeof payload.description === "string" ? payload.description : null;

    const agents = agentService(db);
    const created = await agents.create(card.companyId, {
      name,
      role,
      title,
      icon,
      reportsTo,
      adapterType,
      adapterConfig: {},
      metadata: description ? { description } : {},
      status: "idle",
    } as Parameters<typeof agents.create>[1]);

    return { createdAgentId: created.id, name: created.name, role: created.role };
  }

  async function acceptTaskCompletion(card: Awaited<ReturnType<typeof cardsSvc.getById>>): Promise<Record<string, unknown>> {
    if (!card) throw new Error("Card not found");
    const payload = card.payload ?? {};
    const taskIssueId = typeof payload.issueId === "string" ? payload.issueId : "";
    if (!taskIssueId) throw new Error("task_completion payload missing `issueId`");

    const issuesSvc = issueService(db);
    const updated = await issuesSvc.update(taskIssueId, { status: "done" });
    if (!updated) throw new Error(`Issue ${taskIssueId} not found`);
    return { taskIssueId, status: "done" };
  }

  router.get("/by-slug/:slug", async (req, res) => {
    const slug = String(req.params.slug);
    const resolved = await svc.getBySlug(slug);
    if (!resolved) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    assertCompanyAccess(req, resolved.company.id);
    res.json({
      company: resolved.company,
      redirectedFromSlug: resolved.redirected ? slug.toLowerCase() : null,
    });
  });

  router.post("/draft", validate(createDraftCompanySchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    const company = await svc.create({
      name: req.body.name ?? "Untitled Company",
      draft: true,
    });
    await access.ensureMembership(company.id, "user", req.actor.userId ?? "local-board", "owner", "active");
    const room = await boardroom.getOrCreate(company.id);
    await seedOnboardingCeo({ db, companyId: company.id, boardroomIssueId: room.id });
    await logActivity(db, {
      companyId: company.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.draft_created",
      entityType: "company",
      entityId: company.id,
      details: { slug: company.slug },
    });
    res.status(201).json(company);
  });

  router.patch("/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const actor = getActorInfo(req);
    const existingCompany = await svc.getById(companyId);
    if (!existingCompany) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    let body: Record<string, unknown>;

    if (req.actor.type === "agent") {
      // Only CEO agents may update company branding fields
      const agentSvc = agentService(db);
      const actorAgent = req.actor.agentId ? await agentSvc.getById(req.actor.agentId) : null;
      if (!actorAgent || actorAgent.role !== "ceo") {
        throw forbidden("Only CEO agents or board users may update company settings");
      }
      if (actorAgent.companyId !== companyId) {
        throw forbidden("Agent key cannot access another company");
      }
      body = updateCompanyBrandingSchema.parse(req.body);
    } else {
      assertBoard(req);
      body = updateCompanySchema.parse(req.body);

      if (body.feedbackDataSharingEnabled === true && !existingCompany.feedbackDataSharingEnabled) {
        body = {
          ...body,
          feedbackDataSharingConsentAt: new Date(),
          feedbackDataSharingConsentByUserId: req.actor.userId ?? "local-board",
          feedbackDataSharingTermsVersion:
            typeof body.feedbackDataSharingTermsVersion === "string" && body.feedbackDataSharingTermsVersion.length > 0
              ? body.feedbackDataSharingTermsVersion
              : DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION,
        };
      }
    }

    const company = await svc.update(companyId, body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: body,
    });
    res.json(company);
  });

  router.patch("/:companyId/branding", validate(updateCompanyBrandingSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanUpdateBranding(req, companyId);
    const company = await svc.update(companyId, req.body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.branding_updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(company);
  });

  router.post("/:companyId/archive", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.archive(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.archived",
      entityType: "company",
      entityId: companyId,
    });
    res.json(company);
  });

  router.delete("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.remove(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
