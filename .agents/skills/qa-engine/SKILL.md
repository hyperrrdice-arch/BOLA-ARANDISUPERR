---
name: qa-engine
description: Mandatory delegation to the qa-engine subagent for background TypeScript typechecks, Next.js build compilation, and regression test script execution.
---

# QA Engine Subagent Delegation

This slash command routes the request directly to the specialized **`qa-engine`** subagent.

## Execution Directives

1. **Mandatory Delegation**: Delegate build verification, TypeScript compiler runs, and test script executions to the `qa-engine` subagent.
2. **Invoke Subagent**: Immediately call the `invoke_subagent` tool with:
   - `TypeName`: `qa-engine`
   - `Role`: `QA Build Specialist`
   - `Model`: `flash` (Gemini 3.8 Flash Low / Fast)
   - `Workspace`: `inherit`
   - `Prompt`: Pass the test script names, compiler checks (`tsc --noEmit`), or build verification targets.
3. **Report Back**: Summarize the pass/fail diagnostics and specific error lines returned by `qa-engine`.
