# Google Antigravity SDK Rules & Best Practices

When implementing or interacting with the Google Antigravity SDK or the Antigravity Agent Runtime in this project:

1. **Runtime Harness & Safety**:
   - Always run agents within async context managers (`async with Agent(config) as agent:`) to ensure proper cleanup of runtime binaries and sockets.
   - Restrict tool capabilities explicitly via `CapabilitiesConfig`. Only grant write tools (`run_command`, `replace_file_content`, `write_to_file`) when required.

2. **Event Streaming & Handling**:
   - Handle response streaming reactively using `async for token in response`.
   - Separate thought streaming (`response.thoughts`) from tool execution events (`response.tool_calls`) for proper observability.

3. **Node.js & ConnectRPC Integration**:
   - For Node.js/TypeScript environments, communicate with the local Antigravity Language Server over ConnectRPC using `ANTIGRAVITY_LS_ADDRESS` and header `x-codeium-csrf-token: ${ANTIGRAVITY_CSRF_TOKEN}`.
   - Always validate JSON payload schemas before dispatching RPC calls.

4. **Workspace Isolation**:
   - Keep all agent configurations, prompts, and temporary data inside project workspace or project scratch directories.
