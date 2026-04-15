/**
 * Wire protocol for inline cards that agents emit into the Boardroom stream.
 *
 * Agents embed a fenced code block with info string `paperclip-card`
 * containing a JSON object. The server parses these out on comment save,
 * persists a row in `boardroom_cards`, and the UI renders the card inline
 * (while stripping the raw block from the markdown body).
 *
 * Example agent output:
 *
 * ```paperclip-card
 * {
 *   "kind": "hire_proposal",
 *   "name": "Ada",
 *   "role": "engineer",
 *   "adapterType": "claude_local",
 *   "description": "Ships features from the design-doc backlog."
 * }
 * ```
 */

export const BOARDROOM_CARD_FENCE_TAG = "paperclip-card";

/** Matches ```paperclip-card ... ``` blocks, tolerant of leading whitespace. */
const CARD_BLOCK_REGEX = /^[ \t]*```paperclip-card[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gm;

export interface ParsedBoardroomCard {
  kind: string;
  payload: Record<string, unknown>;
  raw: string;
}

export interface ParseBoardroomCardsResult {
  cards: ParsedBoardroomCard[];
  errors: Array<{ raw: string; reason: string }>;
}

export function parseBoardroomCardBlocks(body: string): ParseBoardroomCardsResult {
  const cards: ParsedBoardroomCard[] = [];
  const errors: Array<{ raw: string; reason: string }> = [];
  if (!body) return { cards, errors };

  CARD_BLOCK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CARD_BLOCK_REGEX.exec(body)) !== null) {
    const raw = match[0];
    const inner = match[1]?.trim() ?? "";
    if (!inner) {
      errors.push({ raw, reason: "empty body" });
      continue;
    }
    try {
      const parsed = JSON.parse(inner) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push({ raw, reason: "not a JSON object" });
        continue;
      }
      const obj = parsed as Record<string, unknown>;
      const kind = typeof obj.kind === "string" ? obj.kind.trim() : "";
      if (!kind) {
        errors.push({ raw, reason: "missing kind" });
        continue;
      }
      const { kind: _k, ...payload } = obj;
      cards.push({ kind, payload, raw });
    } catch (err) {
      errors.push({
        raw,
        reason: err instanceof Error ? err.message : "JSON parse error",
      });
    }
  }
  return { cards, errors };
}

/**
 * Remove all paperclip-card fenced blocks from a markdown body. Used by the
 * UI so the raw JSON doesn't render next to the rich card component.
 */
export function stripBoardroomCardBlocks(body: string): string {
  if (!body) return body;
  return body.replace(CARD_BLOCK_REGEX, "").replace(/\n{3,}/g, "\n\n").trim();
}
