<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Ignore routine debugging and unverified changes. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Keep a qualifying candidate through the reporting pass even if you resolve or work around it. A successful fix changes the report outcome; it does not erase the friction that qualified it.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `node node_modules/next/dist/bin/next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->

<!-- BEGIN:subagent-and-model-rules -->

## Subagent Architecture & Execution Rules

1. **Lead Orchestrator**: The primary agent is ALWAYS the lead orchestrator. Never generate standalone intermediate orchestrator subagents. Delegate directly to specialized worker subagents (`quant-auditor`, `frontend-architect`, `sports-data-auditor`, `qa-engine`, `api-schema-explorer`, `repo-manager`).
2. **Subagent Discovery & UI Visibility**: All custom subagents in `.agents/agents/` MUST specify `mainAgent: true` and `subagent: true` in their YAML frontmatter so they remain discoverable and selectable in the UI agent picker.
3. **Strict Workspace Scope**: Keep all agent configurations, scripts, and customizations strictly within the project repository (`.agents/agents/`). NEVER write or copy customizations to the global machine scope (`~/.gemini/config/`).
4. **Model Tier & Thinking Modes**: Standardize exclusively on Gemini 3.8 Flash:
   - **High Thinking** (`inherit`): Mathematical quant modeling, Dixon-Coles Poisson validation, Shin vig-stripping, and Kelly risk models.
   - **Medium Thinking** (`flash`): Architecture planning, modular component decomposition, UI design, external API schema mapping (`api-schema-explorer`), and Git/GitHub release operations (`repo-manager`).
   - **Low / Fast Thinking** (`flash`): Zod schema sanitization, API ingestion, rapid typechecks (`tsc`), and non-blocking test runners.
5. **Frontend Multi-Style Flexibility**: Do not constrain frontend designs to Notion UI. Actively support diverse styles: modern sports analytics (SofaScore/FlashScore), high-density quantitative terminals (Bloomberg dark mode), sleek glassmorphism, and clean SaaS dashboards.

<!-- END:subagent-and-model-rules -->
