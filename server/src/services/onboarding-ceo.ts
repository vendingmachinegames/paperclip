import type { Db } from "@paperclipai/db";
import { issueComments } from "@paperclipai/db";
import { agentService } from "./agents.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { loadDefaultAgentInstructionsBundle } from "./default-agent-instructions.js";

/**
 * One-shot seed for a brand-new company: creates a CEO agent, materializes
 * the office-hours onboarding instructions bundle to disk, and posts a
 * welcome message in the Boardroom authored by that agent. The CEO is
 * created idle — on local_trusted installs the claude_local adapter
 * generally has what it needs out of the box, and failures will surface
 * as a real heartbeat error rather than silent friction. If the adapter
 * isn't set up, the first @mention will fail with a clear diagnostic.
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
  const instructions = agentInstructionsService();

  const ceo = await agents.create(companyId, {
    name: "CEO",
    role: "ceo",
    title: "Chief Executive Officer",
    icon: "briefcase",
    status: "idle",
    adapterType: "claude_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  });

  // Materialize the onboarding-variant bundle. The file that lands on
  // disk as HEARTBEAT.md contains the office-hours interview prompt;
  // when the company graduates out of draft, a single content swap
  // flips it to the steady-state heartbeat.
  const files = await loadDefaultAgentInstructionsBundle("ceo", "onboarding");
  const { adapterConfig: materializedAdapterConfig } = await instructions.materializeManagedBundle(
    ceo,
    files,
    { entryFile: "AGENTS.md", replaceExisting: false },
  );
  const updatedCeo = await agents.update(ceo.id, { adapterConfig: materializedAdapterConfig });

  await db.insert(issueComments).values({
    companyId,
    issueId: boardroomIssueId,
    authorAgentId: ceo.id,
    body: welcomeBody(),
  });

  return { ceo: updatedCeo ?? ceo };
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
    "what we're building. I'm blunt on purpose: my interview is",
    "adapted from YC's [office-hours playbook](https://github.com/garrytan/gstack),",
    "which pushes back on vague answers rather than agreeing with",
    "them.",
    "",
    "**First question:** Is this **a business you're trying to grow**,",
    "or **a side project / experiment / learning exercise**? The",
    "answer changes how hard I'll push back on you.",
    "",
    "Reply with `@CEO ...` when you're ready — I'll take it from there.",
  ].join("\n");
}
