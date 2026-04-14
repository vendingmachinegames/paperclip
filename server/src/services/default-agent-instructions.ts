import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

/**
 * Variant selector for bundles where the same role needs different content
 * based on company state. Currently only `"onboarding"` is defined: the
 * CEO's heartbeat runs the office-hours interview instead of the normal
 * steady-state loop while the company is still in draft.
 */
export type DefaultAgentBundleVariant = "onboarding";

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

/**
 * For the CEO onboarding variant, the file served as `HEARTBEAT.md` in
 * the agent's managed workspace is actually loaded from
 * `ONBOARDING_HEARTBEAT.md` on disk. Keeping the destination filename
 * stable means graduating the company out of draft is a single content
 * swap, not a rename.
 */
function resolveSourceFileName(
  role: DefaultAgentBundleRole,
  fileName: string,
  variant: DefaultAgentBundleVariant | undefined,
): string {
  if (variant === "onboarding" && role === "ceo" && fileName === "HEARTBEAT.md") {
    return "ONBOARDING_HEARTBEAT.md";
  }
  return fileName;
}

export async function loadDefaultAgentInstructionsBundle(
  role: DefaultAgentBundleRole,
  variant?: DefaultAgentBundleVariant,
): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const sourceFileName = resolveSourceFileName(role, fileName, variant);
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, sourceFileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  return role === "ceo" ? "ceo" : "default";
}
