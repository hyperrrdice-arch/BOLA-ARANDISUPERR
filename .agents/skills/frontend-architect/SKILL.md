---
name: frontend-architect
description: Mandatory delegation to the frontend-architect subagent for Next.js Tailwind UI design, component modularization, anti-slop aesthetic taste, and sports dashboard architecture.
---

# Frontend Architect Subagent Delegation

This slash command routes the request directly to the specialized **`frontend-architect`** subagent.

## Execution Directives

1. **Mandatory Delegation**: Do NOT write or refactor complex frontend UI code directly as the lead orchestrator.
2. **Invoke Subagent**: Immediately call the `invoke_subagent` tool with:
   - `TypeName`: `frontend-architect`
   - `Role`: `Lead Frontend UI/UX Architect`
   - `Model`: `inherit` (Gemini 3.8 Flash High)
   - `Workspace`: `inherit`
   - `Prompt`: Pass the user's UI request, design brief, component refactoring targets, or aesthetic styling instructions.
3. **Report Back**: Once `frontend-architect` completes the changes, present the resulting UI components and design choices clearly to the user.
