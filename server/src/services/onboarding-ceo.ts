import type { Db } from "@paperclipai/db";
import { issueComments } from "@paperclipai/db";
import { agentService } from "./agents.js";

/**
 * One-shot seed for a brand-new company: creates a CEO agent and posts a
 * welcome message in the Boardroom authored by that agent. The CEO is
 * created in "paused" state so no heartbeat fires until the founder has
 * configured the adapter (API key, command, etc.).
 *
 * Called after the company + Boardroom exist.
 */
export async function seedOnboardingCeo(params: {
  db: Db;
  companyId: string;
  boardroomIssueId: string;
}) {
  const { db, companyId, boardroomIssueId } = params;
  const agents = agentService(db);

  const ceo = await agents.create(companyId, {
    name: "CEO",
    role: "ceo",
    title: "Chief Executive Officer",
    icon: "briefcase",
    status: "paused",
    pauseReason: "manual",
    adapterType: "claude_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  });

  await db.insert(issueComments).values({
    companyId,
    issueId: boardroomIssueId,
    authorAgentId: ceo.id,
    body: welcomeBody(),
  });

  return { ceo };
}

function welcomeBody(): string {
  return [
    "**Welcome to the Boardroom.**",
    "",
    "I'm your CEO. This is the shared chat for this company — you,",
    "me, and every agent you hire will coordinate in here, in the",
    "open.",
    "",
    "Before I start doing anything for you, I need to understand",
    "what we're building. I'm going to feel blunt: my interview is",
    "adapted from YC's [office-hours playbook](https://github.com/garrytan/gstack),",
    "which is designed to push back on vague answers rather than",
    "agreeing with them. That's the point.",
    "",
    "I'm currently paused — until you configure my adapter, I can't",
    "actually respond in this chat. You'll find me in the **Agents**",
    "section in the sidebar. Once I'm configured and unpaused,",
    "@mention me in here and I'll kick off the interview.",
  ].join("\n");
}
