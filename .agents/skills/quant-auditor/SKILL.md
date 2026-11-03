---
name: quant-auditor
description: Mandatory delegation to the quant-auditor subagent for statistical analysis, Dixon-Coles Poisson modeling, Shin vig-stripping verification, and Kelly risk models.
---

# Quant Auditor Subagent Delegation

This slash command routes the request directly to the specialized **`quant-auditor`** subagent.

## Execution Directives

1. **Mandatory Delegation**: Do NOT execute quantitative or statistical modeling calculations directly as the lead orchestrator.
2. **Invoke Subagent**: Immediately call the `invoke_subagent` tool with:
   - `TypeName`: `quant-auditor`
   - `Role`: `Quantitative Analytics Auditor`
   - `Model`: `inherit` (Gemini 3.8 Flash High)
   - `Workspace`: `inherit`
   - `Prompt`: Pass the user's prompt, target match context, or quantitative formulas to be audited.
3. **Report Back**: Once `quant-auditor` reports its findings, summarize the mathematical conclusions clearly to the user.
