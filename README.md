# claude-api

A monorepo with two packages that provide a unified Anthropic Messages API for **Claude** (via the CLI) and **open-source models** (via Ollama):

- **[`@anagnole/claude-cli-wrapper`](https://www.npmjs.com/package/@anagnole/claude-cli-wrapper)** — Shared library with a provider abstraction for Claude CLI and Ollama. Published on npm — install with `npm install @anagnole/claude-cli-wrapper`.
- **`@anagnole/claude-api-server`** — Anthropic Messages API-compatible HTTP server. Point any Anthropic SDK at it and use Claude, Llama, Mistral, or any Ollama model through one endpoint.

The provider abstraction makes it easy to add new providers. Claude models route through the CLI (with full MCP, permissions, worktree support). Everything else routes to Ollama by default.

## Quick start

```bash
cd ~/Projects/claude-api
pnpm install

# Start the API server
pnpm dev
```

The server starts at `http://127.0.0.1:4301`.

## Two ways to use this

### Option A: Use the core library directly (TypeScript/Node.js)

For projects that want programmatic control over multiple model providers through a single interface.

```bash
npm install @anagnole/claude-cli-wrapper
```

#### Provider abstraction

The library provides a `Provider` interface with built-in implementations for Claude CLI and Ollama. Use the `ProviderRegistry` to route requests by model ID automatically.

```typescript
import {
  ProviderRegistry,
  ClaudeCliProvider,
  OllamaProvider,
} from "@anagnole/claude-cli-wrapper";

// Build a registry with both providers
const registry = new ProviderRegistry();
registry.register(new ClaudeCliProvider({ defaultModel: "claude-sonnet-4-6" }));
registry.register(new OllamaProvider({ baseUrl: "http://localhost:11434" }));

// Route automatically by model ID
const provider = registry.resolve("llama3.2:3b");   // → OllamaProvider
const provider2 = registry.resolve("claude-sonnet-4-6"); // → ClaudeCliProvider

// Same API regardless of provider
const response = await provider.complete({
  model: "llama3.2:3b",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.content[0].text);

// Streaming works the same way
const cancel = provider.stream(request, {
  onEvent: (sse) => process.stdout.write(sse),
  onDone: () => console.log("done"),
  onError: (err) => console.error(err),
});
```

Or use a provider directly:

```typescript
const ollama = new OllamaProvider({ baseUrl: "http://gpu-box:11434" });
const response = await ollama.complete({
  model: "mistral:7b",
  messages: [{ role: "user", content: "Hello" }],
});
```

#### Custom providers

Implement the `Provider` interface to add any model source:

```typescript
import type { Provider } from "@anagnole/claude-cli-wrapper";

class TogetherProvider implements Provider {
  readonly name = "together";
  canHandle(model: string) { return model.startsWith("together/"); }
  async listModels() { /* ... */ }
  async complete(request) { /* ... */ }
  stream(request, callbacks) { /* ... */ }
}

registry.register(new TogetherProvider({ apiKey: "..." }));
```

#### Low-level CLI access

You can also use the Claude CLI directly for full control:

```typescript
import { spawnClaude, NdjsonParser } from "@anagnole/claude-cli-wrapper";

const child = spawnClaude({
  prompt: "Explain this codebase",
  model: "claude-sonnet-4-6",
  streaming: true,
  permissionMode: "bypassPermissions",
  mcpConfig: "/path/to/mcp.json",
  maxTurns: 10,
});

const parser = new NdjsonParser();
child.stdout.on("data", (chunk) => {
  for (const event of parser.feed(chunk.toString())) {
    console.log(event);
  }
});
```

#### All exports

```typescript
// Providers
ProviderRegistry, ClaudeCliProvider, OllamaProvider
Provider, ModelInfo, ProviderStreamCallbacks  // types
ClaudeCliProviderOptions, OllamaProviderConfig // types

// CLI (low-level)
spawnClaude, SpawnOptions, NdjsonParser

// Session
SessionMap, SessionLookup

// Transform
extractPrompt, extractSystem, warnUnsupported
buildResponse, generateMsgId
createStreamState, transformEvent, StreamState

// Types
ContentBlock, SystemBlock, MessageParam,
MessagesRequest, MessagesResponse, Usage, ApiError, apiError
```

### Option B: Use the HTTP API server

For projects using any language/SDK that speaks the Anthropic Messages API. Supports both Claude and Ollama models through the same endpoint.

#### Start the server

```bash
pnpm dev
# or with custom config:
OLLAMA_BASE_URL=http://gpu-box:11434 CLAUDE_API_PORT=4301 pnpm dev
```

If Ollama is running, its models are available immediately. No config needed.

#### Environment variables (for your client)

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:4301
ANTHROPIC_API_KEY=dummy   # any value works, auth is not enforced
```

#### TypeScript (Anthropic SDK)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "dummy",
  baseURL: "http://127.0.0.1:4301",
});

// Use Claude
const msg1 = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});

// Use Ollama models — same SDK, same endpoint
const msg2 = await client.messages.create({
  model: "llama3.2:3b",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

#### Python (Anthropic SDK)

```python
import anthropic

client = anthropic.Anthropic(
    api_key="dummy",
    base_url="http://127.0.0.1:4301",
)

# Works with any model — Claude or Ollama
message = client.messages.create(
    model="mistral:7b",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)
```

#### curl

```bash
# Claude model
curl http://127.0.0.1:4301/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Ollama model — same endpoint, same format
curl http://127.0.0.1:4301/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2:3b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Streaming
curl -N http://127.0.0.1:4301/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2:3b",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# List all models (Claude + Ollama)
curl http://127.0.0.1:4301/v1/models
```

## API reference

### `POST /v1/messages`

Accepts the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) request body, plus CLI extension parameters.

#### Standard parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `model` | string | Yes | Any Claude model (`claude-sonnet-4-6`) or Ollama model (`llama3.2:3b`, `mistral:7b`) |
| `messages` | array | Yes | `[{ role, content }]` |
| `max_tokens` | number | No | Accepted but not enforced |
| `system` | string/array | No | System prompt |
| `stream` | boolean | No | SSE streaming |
| `effort` | string | No | `"low"` / `"medium"` / `"high"` / `"max"` |
| `json_schema` | object | No | Structured output schema |

**Ignored by Claude CLI**: `temperature`, `top_p`, `top_k`, `stop_sequences`, `tools`, `tool_choice` (Ollama supports `temperature`, `top_p`, `top_k`, `stop_sequences`)

#### CLI extension parameters

All optional. Pass in the request body alongside standard params.

| Parameter | Type | CLI flag | Description |
|---|---|---|---|
| **Permission & tools** | | | |
| `permission_mode` | string | `--permission-mode` | `"plan"`, `"bypassPermissions"`, etc. |
| `dangerously_skip_permissions` | boolean | `--dangerously-skip-permissions` | Skip all prompts |
| `allowed_tools` | string[] | `--allowedTools` | Auto-approve: `["Bash(git *)","Read"]` |
| `disallowed_tools` | string[] | `--disallowedTools` | Remove tools entirely |
| `cli_tools` | string | `--tools` | `""` disables all, `"default"` for all |
| **MCP** | | | |
| `mcp_config` | string | `--mcp-config` | Path to MCP config JSON |
| `strict_mcp_config` | boolean | `--strict-mcp-config` | Only use specified MCP servers |
| **Session** | | | |
| `resume_session_id` | string | `--resume` | Resume specific session |
| `continue_conversation` | boolean | `--continue` | Continue most recent |
| `fork_session` | boolean | `--fork-session` | Fork on resume |
| `append_system_prompt` | boolean | `--append-system-prompt` | Append instead of replace |
| **Limits** | | | |
| `max_turns` | number | `--max-turns` | Max agentic turns |
| `max_budget_usd` | number | `--max-budget-usd` | Max dollar spend |
| **Workspace** | | | |
| `working_directory` | string | `cwd` | CLI working directory |
| `worktree` | string | `--worktree` | Isolated git worktree |
| `add_dirs` | string[] | `--add-dir` | Additional directories |
| **Model** | | | |
| `fallback_model` | string | `--fallback-model` | Fallback if overloaded |

#### Response

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello!" }],
  "model": "claude-sonnet-4-6",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 3,
    "output_tokens": 5,
    "cache_creation_input_tokens": 1352,
    "cache_read_input_tokens": 15122
  },
  "session_id": "uuid-for-resume",
  "cost_usd": 0.031,
  "duration_ms": 1286,
  "num_turns": 1
}
```

Streaming returns `text/event-stream` SSE: `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`

### `POST /v1/messages/:id/cancel`

Kill a running CLI process by message ID.

### `GET /v1/models`

List available models.

### `GET /health`

Returns `{ "status": "ok" }`.

## Multi-turn conversations

The API is stateless (full history each request). The CLI is stateful (`--resume`). The server bridges them automatically by hashing message history to find resumable sessions.

You can also pass `resume_session_id` directly (returned as `session_id` in every response).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_API_PORT` | `4301` | Server port |
| `CLAUDE_API_HOST` | `127.0.0.1` | Bind address |
| `CLAUDE_PATH` | `claude` | Claude CLI binary path |
| `OLLAMA_ENABLED` | `true` | Set to `"false"` to disable Ollama |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL_PREFIX` | `""` | Optional prefix (e.g. `"ollama/"`) to namespace model IDs |

## Architecture

```
packages/
  core/                  # @anagnole/claude-cli-wrapper — shared library
    src/
      index.ts           # Barrel export
      types.ts           # Request/response types + CLI extensions
      provider/
        types.ts         # Provider interface, ModelInfo, callbacks
        registry.ts      # ProviderRegistry — model routing + merged listing
        claude-cli-provider.ts  # Claude CLI provider (spawn, sessions, transforms)
        ollama-provider.ts      # Ollama HTTP provider (translate ↔ Anthropic format)
      cli/
        spawn.ts         # Spawn claude CLI with all flags
        parser.ts        # NDJSON line parser
      session/
        session-map.ts   # Hash-based session tracking (used by ClaudeCliProvider)
      transform/
        request.ts       # Extract prompt, system, warn unsupported
        response.ts      # CLI result → API response
        stream.ts        # CLI NDJSON → SSE events
  server/                # @anagnole/claude-api-server — HTTP API
    src/
      server.ts          # Fastify setup + provider registry
      config.ts          # Env-based config (Claude + Ollama)
      routes/
        messages.ts      # POST /v1/messages (provider-agnostic)
        models.ts        # GET /v1/models (merged from all providers)
```

## Limitations

- **No custom tool definitions**: `tools` param ignored for Claude. Use `allowed_tools`/`disallowed_tools` for built-in tools, `mcp_config` for custom tool servers.
- **Ollama is text-only**: Tool use, vision, and Claude-specific features (MCP, permissions, worktrees) are not available for Ollama models.
- **No token counting endpoint**: `POST /v1/messages/count_tokens` not available.
- **No batches endpoint**: `POST /v1/messages/batches` not implemented.
- **Session memory is in-process**: Lost on server restart. Use `resume_session_id` for explicit session management. Ollama models are stateless (full history sent each request).
