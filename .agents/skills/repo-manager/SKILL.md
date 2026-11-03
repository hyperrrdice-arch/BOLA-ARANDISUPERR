---
name: repo-manager
description: Mandatory delegation to the repo-manager subagent for Git/GitHub repository operations, atomic Conventional Commits, branch management, CI/CD Actions, and SemVer releases.
---

# Repo Manager Subagent Delegation

This slash command routes the request directly to the specialized **`repo-manager`** subagent.

## Execution Directives

1. **Mandatory Delegation**: Do NOT stage, commit, or manage repository releases directly as the lead orchestrator.
2. **Invoke Subagent**: Immediately call the `invoke_subagent` tool with:
   - `TypeName`: `repo-manager`
   - `Role`: `Git & GitHub Repository Specialist`
   - `Model`: `flash` (Gemini 3.8 Flash Medium)
   - `Workspace`: `inherit`
   - `Prompt`: Pass the user's git instruction, release bump request, or CI/CD workflow task.
3. **Report Back**: Once `repo-manager` completes the git actions, display the commit hashes, git status diffs, or release notes to the user.
