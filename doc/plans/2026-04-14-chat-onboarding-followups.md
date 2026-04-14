# Chat-onboarding follow-ups

Running list of tweaks surfaced while driving the new first-run flow.
Kept here so nothing is lost between sessions. Each item should turn
into its own slice (or get merged into an existing one) when picked up.

Add new entries at the bottom with a date + one-line rationale. Keep
them small — if a note grows past a paragraph, it wants its own plan
file.

## Adapter ecosystem

- **Ollama adapter support.** Upstream has ~40 open issues/PRs around
  Ollama (PR #2156 is the main `ollama_local` adapter; #1571 / #2581
  route opencode_local to Ollama; #2362 / #3620 for Qwen defaults).
  Nothing merged. Options: cherry-pick #2156, lean on opencode_local
  as a proxy, use the `http` adapter against `llm:11434`, or write an
  external adapter plugin via `~/.paperclip/adapter-plugins.json`.
  Blocking for users who don't want to pay for Anthropic API calls
  during the office-hours interview.

## Onboarding UX

<!-- Add notes as you hit them during the flow. -->
