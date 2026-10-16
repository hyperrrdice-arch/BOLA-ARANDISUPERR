---
name: api-schema-explorer
description: Mandatory delegation to the api-schema-explorer subagent for inspecting external API structures, generating Zod schemas, TypeScript types, and adapter clients.
---

# API Schema Explorer Subagent Delegation

This slash command routes the request directly to the specialized **`api-schema-explorer`** subagent.

## Execution Directives

1. **Mandatory Delegation**: Delegate new API exploration, schema mapping, and Zod validator creation to `api-schema-explorer`.
2. **Invoke Subagent**: Immediately call the `invoke_subagent` tool with:
   - `TypeName`: `api-schema-explorer`
   - `Role`: `API Architecture & Schema Specialist`
   - `Model`: `flash` (Gemini 3.8 Flash Medium)
   - `Workspace`: `inherit`
   - `Prompt`: Pass the target API documentation, endpoints, or sample raw JSON payloads to be explored and mapped.
3. **Report Back**: Present the generated Zod schemas, TypeScript types, and adapter designs created by `api-schema-explorer`.
