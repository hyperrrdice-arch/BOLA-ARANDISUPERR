---
name: sports-data-auditor
description: Mandatory delegation to the sports-data-auditor subagent for auditing TheStatsAPI and 1xBet data ingestion, Zod schema sanitization, and Closed-World Grounding.
---

# Sports Data Auditor Subagent Delegation

This slash command routes the request directly to the specialized **`sports-data-auditor`** subagent.

## Execution Directives

1. **Mandatory Delegation**: Delegate data integrity checks, RAM cache TTL audits, and anti-hallucination compliance to `sports-data-auditor`.
2. **Invoke Subagent**: Immediately call the `invoke_subagent` tool with:
   - `TypeName`: `sports-data-auditor`
   - `Role`: `Sports Data Integrity & Grounding Auditor`
   - `Model`: `flash` (Gemini 3.8 Flash Medium)
   - `Workspace`: `inherit`
   - `Prompt`: Pass the target data parser (`lib/stats-*`), caching strategy, or syndicate grounding prompt to audit.
3. **Report Back**: Summarize the data sanitization findings, missing field registries, or quota optimization metrics.
