# Chat-plugin onboarding — project status

Snapshot of the `chat-plugin-onboarding` branch. Captures what's
landed, what's next, and the operational state so a cold restart
doesn't lose the thread.

Working directory: `~/ai/paperclip` (fork of HenkDz/paperclip, which
forks paperclipai/paperclip). Remote: `vendingmachinegames/paperclip`.

## Goal

Replace the old linear-wizard onboarding with a **Boardroom-centric
chat** where a CEO agent interviews the founder using a port of
gstack's `/office-hours` skill. Everything the company does (agent↔agent
coordination, user↔agent conversation, artifact creation) happens in
one visible stream rather than a bunch of hidden DMs and forms.

Key design calls (decided earlier, not revisitable without new reason):

- **Boardroom, not DMs.** One shared conversation-kind issue per
  company. All agents participate in the open. Agents cannot start
  private channels with each other; only the user can open a DM with
  an agent.
- **Draft company up front.** First visit creates a draft company with
  a throwaway `draft-<nano6>` slug; the CEO renames it mid-conversation
  via the `propose_company_identity` tool (not yet wired). URL flips
  in place via `history.replaceState`; old slug redirects forever.
- **Ticket keys stay stable.** `issuePrefix` (ACME-42) is separate from
  `slug` (/acme). Renames only touch slug; tickets keep their old
  prefix so external references survive.
- **No team templates.** The CEO reasons the team shape from the six
  office-hours forcing questions. Explicit anti-template rule in the
  onboarding prompt.

## Landed work

15 commits on `chat-plugin-onboarding`, all tests green (1132 passing,
1 skipped), full `pnpm -r typecheck` clean.

### Schema + server infrastructure

- `e4a13cfc` **Slice 1a** — `companies.slug` (TEXT NOT NULL UNIQUE,
  default `gen_random_uuid()::text`) + `companies.is_draft` +
  `company_slug_redirects` table. Migration 0056 backfills from
  `lower(issue_prefix)`. New `POST /api/companies/draft` endpoint.
- `2a070ced` **Slice 1b** — `companyService.update()` writes the
  retired slug into redirects atomically, rejects conflicts as 422,
  clears stale redirects on slug reclaim.
- `784c5f1d` **Slice 1c** — Express middleware 302s retired-slug
  requests to current canonical. `GET /api/companies/by-slug/:slug`
  resolves live+retired with a flag. 18 integration tests.
- `e6dbf9c2` **Slice 2** — `issues.kind` enum (`task` | `conversation`,
  migration 0057). `boardroomService` with `getOrCreate`. Auto-created
  on company create (normal, draft, import). `GET /:id/boardroom`
  endpoint. Task-centric queries (`issueService.list`, unread count,
  dashboard task rows) filter `kind='task'`.

### UI routing

- `043b740d` **Slice 1d** — flipped URL routing from uppercase issue
  prefix (`/ACME/...`) to lowercase slug (`/acme/...`). Rename of 92
  symbols across 21 files: `companyPrefix` → `companySlug`,
  `normalizeCompanyPrefix` → `normalizeCompanySlug`, etc. Plugin SDK
  field renamed too. Legacy uppercase URLs still resolve.
- `6b195a8e` **Slice 3** — minimal Boardroom page at
  `/:slug/boardroom`. 5-second polling, Identity avatar, MarkdownBody,
  agent badge, basic composer with Cmd/Ctrl+Enter. No assistant-ui
  integration yet.
- `fbc5149d` **Slice 4** — `FirstVisitBootstrap` auto-creates a draft
  on root-hit with no companies and redirects into the Boardroom.
  Seeds the query cache + selected-company-id so Layout doesn't flash.
  403 falls back to the classic NoCompaniesStartPage.
- `04ef8b11` — returning users land in Boardroom by default (was
  `/dashboard`).

### Onboarding CEO

- `e3167386` **Slice 6a** — `seedOnboardingCeo` creates a CEO agent
  (role=ceo, claude_local, adapterConfig={}) and posts a welcome
  comment authored by that CEO. Wired into draft create.
- `cd05e96a` **Slice 6b** — office-hours prompt port at
  `server/src/onboarding-assets/ceo/ONBOARDING_HEARTBEAT.md`.
  `default-agent-instructions.ts` variant selector swaps HEARTBEAT.md
  content for ONBOARDING_HEARTBEAT.md while keeping the destination
  filename stable (so graduation from draft is a content swap, not a
  rename). `seedOnboardingCeo` materializes the managed bundle.
- `fcb8145d` — CEO default status flipped from `paused` to `idle`,
  welcome now opens with Q1 (Startup vs Builder mode).

### Fixes discovered while driving the flow

- `6b48845a` — clear stale `selectedCompanyId` from localStorage when
  the referenced company no longer exists (DB wipe across sessions).
  Plus server-side: `GET /:id/skills` 404s for missing company before
  the skills bundler attempts an FK-violating insert.
- `dfa466ab` — three tweaks: (a) suppress the heartbeat's run-summary
  recap comment on conversation-kind issues (was double-posting every
  CEO turn), (b) auto-wake all non-paused agents on any user comment
  to a Boardroom when no explicit `@mention` was found — user no
  longer has to type `@CEO` on every reply, (c) typing-dot indicator
  in Boardroom.tsx for any agent with `status=running`.

### External-adapter work

- `9845797d` **Ollama** — cherry-picked
  `paperclipai/paperclip#2156` (Ganesh Shejul). Full `ollama_local`
  adapter: streaming `/api/chat`, fuzzy model resolution, 15-model
  curated picker with download progress + cancel, base URL override,
  registry integration. Conflict resolutions detailed in the commit
  body — our fork keeps its dynamic adapter-discovery pattern, ollama
  flows through it automatically.

### Docs

- `f63294bc` — running follow-ups log at
  `doc/plans/2026-04-14-chat-onboarding-followups.md`. Ollama item
  recorded there before the adapter landed.

## Current runtime state

Config persisted at `~/.paperclip/instances/default/config.json`:

```json
"server": {
  "deploymentMode": "authenticated",
  "exposure": "private",
  "bind": "tailnet",
  "port": 3100
}
```

- Deployment: `authenticated/private` — first admin claim via
  `paperclipai auth bootstrap-ceo [--force]`, invite URL pinned to
  tailscale IP.
- Bind: tailnet interface — reachable at `llm:3100` (or whatever
  tailscale hostname) across the tailnet.
- Instance admin: already exists in the DB (bootstrap-ceo reports
  "Instance already has an admin user" without `--force`).
- Embedded postgres at `~/.paperclip/instances/default/db`,
  embedded-postgres port 54329.
- JWT secret was set up during earlier `paperclipai onboard`, so
  local adapters authenticate back to the API correctly (no more
  "local-board" misattribution of CEO replies).

To resume:

```bash
# shell 1
~/.npm-global/bin/pnpm dev
# shell 2 (only if bootstrap-ceo is needed)
~/.npm-global/bin/pnpm paperclipai auth bootstrap-ceo --force
```

Global pnpm lives at `~/.npm-global/bin/pnpm` (user-local install;
not on PATH by default — if not yet in `~/.bashrc`, add
`export PATH="$HOME/.npm-global/bin:$PATH"`).

## Known quirks / footguns

- Each draft creation leaves a managed-instructions directory at
  `~/.paperclip/instances/default/companies/<uuid>/agents/<uuid>/`
  that doesn't auto-GC when the company is deleted. Accumulates
  across testing sessions. `rm -rf ~/.paperclip/instances/default/
  companies` after cleanup is safe.
- Company-deletion via `DELETE /api/companies/:id` doesn't remove
  managed instruction directories or runtime-services / workspaces
  on disk. Same fix pattern as above when doing a hard reset.
- Deleting the DB out from under the running UI used to 500 on
  `/skills` — fixed in `6b48845a` but still leaves a stale
  `selectedCompanyId` in localStorage that the new effect clears on
  next load.
- The run-summary recap suppression is conversation-only. Task-style
  issue threads still get recaps, which is the right default there.

## Remaining plans

Ordered roughly by dependency / value.

### 1. Onboarding tools as agent tools

Still the biggest gap to the "CEO actually builds the company" story.
Prompt references these tools — none are wired:

- `update_design_doc_section(section, content)` — fills the live
  design-doc card.
- `propose_company_identity({ name, slug, tagline? })` — renders an
  Accept/Edit identity card; on accept, flips `is_draft=false` and
  renames.
- `create_goal`, `create_agent`, `create_project`, `create_issue` —
  wrap existing REST endpoints and surface as agent tool calls.

Plugin-tool-dispatcher path is the cleanest fit
(`server/src/services/plugin-tool-dispatcher.ts`). Could also be
registered as builtin agent tools if we skip the plugin system.

### 2. Draft graduation

When `propose_company_identity` is accepted:

- Flip `companies.is_draft = false`
- Overwrite the CEO's managed HEARTBEAT.md with the steady-state
  content (filename stable per design — just a content swap)
- Slug rename already works (Slice 1), UI URL replaceState already
  works (needs wiring in the accept handler)

### 3. Inline artifact cards + `#entity` references

Design-doc card, identity-proposal card, goal/agent/project/issue
cards rendered inline in the Boardroom stream. `#entity-id` syntax
in comments resolves to link-cards. Sidebar pinned rail shows
frequently-touched artifacts.

This is the scroll-back-as-reference mechanic that makes the
Boardroom's one-stream design carry its weight. See
`2026-03-11-agent-chat-ui-and-issue-backed-conversations.md` and
`2026-03-13-features.md` for Paperclip maintainers' parallel
thinking.

### 4. assistant-ui / live streaming

Current Boardroom polls every 5s. Paperclip already ships
`@assistant-ui/react` (used in `IssueChatThread`) and has a
SSE/live-run infrastructure. Token-streamed responses would make the
typing-dots redundant and feel a lot better.

### 5. Chat plugin scaffolding (optional refactor)

Move Boardroom page + onboarding tools into an installable plugin
under `packages/plugins/examples/plugin-chat/`. Follows the
`plugin-hello-world-example` shape. This is architectural polish, not
a user-visible feature — leave for after the product feels right.

### 6. Default CEO adapter

Currently `claude_local`. Now that `ollama_local` is available, offer
a choice at first-run or auto-detect based on available adapters.
One-line change to `seedOnboardingCeo` if we just want to flip the
default.

### 7. Onboarding-wizard removal

`ui/src/components/OnboardingWizard.tsx` (~1330 lines) is the legacy
form-based flow. Still reachable via `/onboarding` and
`/:slug/onboarding`. Safe to delete once tools (#1) and graduation
(#2) land — keep until then so there's a fallback path.

### 8. Running follow-ups

See `2026-04-14-chat-onboarding-followups.md` for small tweaks
surfaced during user-driven walks (separate file kept short + ~10 min
items). Ollama item there is now superseded by `9845797d` and should
be struck through.

## Open questions

- **Unpause-the-CEO heuristic.** CEO defaults to `idle` now. That
  assumes `claude_local` is ready on first-run (true on the user's
  machine since Claude Code is authenticated). If a user without an
  API key opens Paperclip cold, the first @mention will fail. Do we
  want a pre-run adapter health check in `seedOnboardingCeo`, or let
  the error surface naturally? Probably the latter — clearer signal.
- **Draft-company proliferation.** Every root-hit with zero companies
  creates a new draft. Refreshing during load could create duplicates
  (idempotency guard is the `didFireRef` useRef in
  `FirstVisitBootstrap` — per-tab). Multiple tabs is the failure
  mode. Not critical yet but worth a session-level dedup eventually.
- **Graduation trigger for design-doc completion.** When does the
  CEO declare onboarding "done"? Explicit Phase 6 handoff in the
  prompt, or heuristic (chose an alternative + hired ≥1 agent)?
  Probably explicit is cleanest.

## PR / upstream posture

Explicitly **not** opening an upstream PR (user's call during
Slice 1). Work lives on the fork. Cherry-pick reference commits back
upstream only if we decide later.

Migrations 0056 and 0057 land right after upstream's 0055
(`0055_kind_weapon_omega.sql`). If upstream ships a migration with
those numbers first, rebasing will need to renumber ours.
