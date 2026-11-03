---
name: staff-code-reviewer
description: Mandatory delegation to the staff-code-reviewer subagent for rigorous Senior Staff Engineer code review, RCA debugging, and performance optimization.
---

# Staff Code Reviewer Subagent Delegation

This slash command routes the request directly to the specialized **`staff-code-reviewer`** subagent.

## Execution Directives

1. **Mandatory Delegation**: Do NOT review code or diagnose complex bugs lightly as the lead orchestrator. Delegate directly to `staff-code-reviewer`.
2. **Invoke Subagent**: Immediately call the `invoke_subagent` tool with:
   - `TypeName`: `staff-code-reviewer`
   - `Role`: `Senior Staff Engineer`
   - `Model`: `inherit` (Gemini 3.8 Flash High)
   - `Workspace`: `inherit`
   - `Prompt`: Pass the files to review, bug descriptions, error call stacks, or performance hotspots to optimize.
3. **Report Back**: Return the comprehensive staff report detailing critical fixes, performance gains, and residual trade-offs.
