# claude-api

A monorepo with two packages for integrating the Claude Code CLI into your projects:

- **[`@anagnole/claude-cli`](https://www.npmjs.com/package/@anagnole/claude-cli)** — Shared library for spawning, parsing, and managing Claude CLI sessions. Published on npm — install with `npm install @anagnole/claude-cli`.
- **`@anagnole/claude-api-server`** — Anthropic Messages API-compatible HTTP server. Point any Anthropic SDK at it and use your Claude Max subscription as a local API.

Both expose the full power of the Claude CLI — MCP servers, permission modes, tool control, git worktrees, cost limits, and more.

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

For projects that want programmatic control over Claude CLI processes without an HTTP layer.

```bash
npm install @anagnole/claude-cli
```

Or as a local workspace reference:

```json
{
  "dependencies": {
    "@anagnole/claude-cli": "workspace:*"
  }
}
```

Or reference it directly via path in your project's `package.json`.

#### Basic usage

```typescript
import { spawnClaude, NdjsonParser } from "@anagnole/claude-cli";

// Spawn a Claude CLI process
const child = spawnClaude({
  prompt: "Explain this codebase",
  model: "claude-sonnet-4-6",
  streaming: true,
});

// Parse streaming NDJSON output
const parser = new NdjsonParser();
child.stdout.on("data", (chunk) => {
  for (const event of parser.feed(chunk.toString())) {
    console.log(event);
  }
});
```

#### With full CLI options

```typescript
import { spawnClaude } from "@anagnole/claude-cli";

const child = spawnClaude({
  prompt: "Fix the auth bug",
  model: "claude-sonnet-4-6",
  streaming: false,

  // System prompt
  systemPrompt: "You are a senior engineer.",
  appendSystemPrompt: true,  // append to default instead of replacing

  // Session management
  resumeSessionId: "uuid-from-previous-run",
  // or: continueConversation: true,

  // Permissions & tools
  permissionMode: "bypassPermissions",
  allowedTools: ["Bash(git *)", "Read", "Edit"],
  disallowedTools: ["Write"],

  // MCP servers
  mcpConfig: "/path/to/mcp-config.json",
  strictMcpConfig: true,

  // Workspace
  workingDirectory: "/path/to/project",
  worktree: "feature-branch",
  addDirs: ["../shared-lib"],

  // Safety limits
  maxTurns: 10,
  maxBudgetUsd: 1.00,

  // Other
  effort: "high",
  fallbackModel: "claude-haiku-4-5",
  jsonSchema: { type: "object", properties: { answer: { type: "string" } } },
});
```

#### Session management

```typescript
import { SessionMap } from "@anagnole/claude-cli";

const sessions = new SessionMap();

// Hash message history to find a resumable session
const hash = SessionMap.hashContext(messages);
const sessionId = sessions.lookup(hash, "claude-sonnet-4-6");

// After a response, store for future --resume
sessions.store(allMessages, cliSessionId, "claude-sonnet-4-6");
```

#### Transform helpers

```typescript
import {
  extractPrompt,      // Get last user message as text
  extractSystem,      // Flatten system prompt blocks to string
  buildResponse,      // CLI JSON result → Anthropic API response shape
  createStreamState,  // Initialize SSE streaming state
  transformEvent,     // CLI NDJSON event → Anthropic SSE strings
  generateMsgId,      // Generate msg_... IDs
} from "@anagnole/claude-cli";
```

#### All exports

```typescript
// CLI
spawnClaude, SpawnOptions, NdjsonParser

// Session
SessionMap

// Transform
extractPrompt, extractSystem, warnUnsupported
buildResponse, generateMsgId
createStreamState, transformEvent, StreamState

// Types
ContentBlock, SystemBlock, MessageParam,
MessagesRequest, MessagesResponse, Usage, ApiError, apiError
```

### Option B: Use the HTTP API server

For projects using any language/SDK that speaks the Anthropic Messages API.

#### Environment variables

Set these in your project:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:4301
ANTHROPIC_API_KEY=dummy   # any value works, auth is not enforced
```

#### Python (Anthropic SDK)

```python
import anthropic

client = anthropic.Anthropic(
    api_key="dummy",
    base_url="http://127.0.0.1:4301",
)

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)
```

#### TypeScript (Anthropic SDK)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "dummy",
  baseURL: "http://127.0.0.1:4301",
});

const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

#### curl

```bash
# Non-streaming
curl http://127.0.0.1:4301/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Streaming
curl -N http://127.0.0.1:4301/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## API reference

### `POST /v1/messages`

Accepts the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) request body, plus CLI extension parameters.

#### Standard parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `model` | string | Yes | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5` |
| `messages` | array | Yes | `[{ role, content }]` |
| `max_tokens` | number | No | Accepted but not enforced |
| `system` | string/array | No | System prompt |
| `stream` | boolean | No | SSE streaming |
| `effort` | string | No | `"low"` / `"medium"` / `"high"` / `"max"` |
| `json_schema` | object | No | Structured output schema |

**Accepted but ignored**: `temperature`, `top_p`, `top_k`, `stop_sequences`, `tools`, `tool_choice`

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

## Architecture

```
packages/
  core/                  # @anagnole/claude-cli — shared library
    src/
      index.ts           # Barrel export
      types.ts           # Request/response types + CLI extensions
      cli/
        spawn.ts         # Spawn claude CLI with all flags
        parser.ts        # NDJSON line parser
      session/
        session-map.ts   # Hash-based session tracking
      transform/
        request.ts       # Extract prompt, system, warn unsupported
        response.ts      # CLI result → API response
        stream.ts        # CLI NDJSON → SSE events
  server/                # @anagnole/claude-api-server — HTTP API
    src/
      server.ts          # Fastify setup
      config.ts          # Env-based config
      routes/
        messages.ts      # POST /v1/messages
        models.ts        # GET /v1/models
```

## Limitations

- **No custom tool definitions**: `tools` param ignored. Use `allowed_tools`/`disallowed_tools` for built-in tools, `mcp_config` for custom tool servers.
- **No sampling params**: `temperature`, `top_p`, `top_k`, `stop_sequences` ignored.
- **No token counting endpoint**: `POST /v1/messages/count_tokens` not available.
- **No batches endpoint**: `POST /v1/messages/batches` not implemented.
- **Session memory is in-process**: Lost on server restart. Use `resume_session_id` for explicit session management.
