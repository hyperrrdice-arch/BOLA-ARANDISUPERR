---
name: antigravity-sdk
description: Comprehensive development guide for Google Antigravity SDK and Antigravity Agent Runtime. Covers programmatic agent lifecycle, Python SDK (google-antigravity), ConnectRPC Language Server APIs for Node.js/TypeScript, tool definitions, streaming responses, and lifecycle hooks.
---

# Google Antigravity SDK Guide

This skill provides architectural patterns, code examples, and interface references for working with the **Google Antigravity SDK** and the **Antigravity Agent Runtime**.

---

## 1. Official Python SDK (`google-antigravity`)

The Python SDK provides programmatic control over the Antigravity agent runtime harness:
* **Repository**: `https://github.com/google-antigravity/antigravity-sdk-python`
* **Installation**: `pip install google-antigravity`

### Basic Asynchronous Agent
```python
import asyncio
import sys
from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig

async def main():
    config = LocalAgentConfig(
        system_instructions="You are an expert AI software engineer.",
        capabilities=CapabilitiesConfig(),  # Enables write tools (run_command, edit_file, etc.)
    )

    async with Agent(config) as agent:
        response = await agent.chat("Analyze the workspace dependencies.")
        async for token in response:
            sys.stdout.write(token)
            sys.stdout.flush()
        print()

if __name__ == "__main__":
    asyncio.run(main())
```

### Streaming Thoughts & Tool Call Telemetry
```python
# Stream internal reasoning thoughts
async for thought in response.thoughts:
    print(f"[Thinking] {thought}")

# Stream strongly typed ToolCall events
async for call in response.tool_calls:
    print(f"[Tool Call] {call.name} -> {call.args}")
```

### Interactive Loop
```python
from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
from google.antigravity.utils.interactive import run_interactive_loop

async with Agent(LocalAgentConfig(capabilities=CapabilitiesConfig())) as agent:
    await run_interactive_loop(agent)
```

---

## 2. Node.js & TypeScript Integration (ConnectRPC)

In JavaScript/TypeScript environments (e.g. Next.js backend, Node.js scripts), you can interact directly with the local Antigravity Language Server via ConnectRPC or HTTP:

### Environment Variables
When Antigravity runs an agent session, it exposes these environment variables:
* `ANTIGRAVITY_LS_ADDRESS`: Address and port of the language server (e.g. `localhost:58133`).
* `ANTIGRAVITY_CSRF_TOKEN`: Secret token required for authenticated requests.

### Client Example (Node.js fetch)
```typescript
interface LSRpcRequest {
  service: string;
  method: string;
  payload: Record<string, unknown>;
}

export async function callLanguageServer<T = unknown>({
  service = "exa.language_server_pb.LanguageServerService",
  method,
  payload,
}: LSRpcRequest): Promise<T> {
  const address = process.env.ANTIGRAVITY_LS_ADDRESS || "localhost:5387";
  const token = process.env.ANTIGRAVITY_CSRF_TOKEN || "";

  const response = await fetch(`http://${address}/${service}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codeium-csrf-token": token,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Antigravity LS error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
```

---

## 3. Custom Tools & Lifecycle Hooks

You can define tools and lifecycle hooks within Antigravity plugins or SDK scripts:
* **Custom Tools**: Expose function signatures with parameter JSON schemas and async execution callbacks.
* **Lifecycle Hooks**: Intercept `pre_tool_execution`, `post_tool_execution`, or `agent_start` events to enforce policy checks, audit logging, or parameter sanitization.
