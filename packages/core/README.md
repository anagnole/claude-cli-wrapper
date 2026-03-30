# @anagnole/claude-cli-wrapper

A shared library providing a unified provider abstraction for [Claude Code CLI](https://code.claude.com), [Ollama](https://ollama.com), and [OpenRouter](https://openrouter.ai) models from TypeScript/Node.js. Use Claude, Llama, Mistral, or any Ollama/OpenRouter model through one API — all returning Anthropic Messages API format.

## Install

```bash
npm install @anagnole/claude-cli-wrapper
```

Requires the Claude CLI (`claude`) for Claude models, and/or Ollama for local models, and/or an OpenRouter API key for free cloud models.

## Provider abstraction

The `ProviderRegistry` routes requests to the right provider based on model ID. Claude models go through the CLI, `openrouter/` prefixed models go to OpenRouter, everything else falls through to Ollama.

```typescript
import {
  ProviderRegistry,
  ClaudeCliProvider,
  OllamaProvider,
  OpenRouterProvider,
} from "@anagnole/claude-cli-wrapper";

const registry = new ProviderRegistry();
registry.register(new ClaudeCliProvider({ defaultModel: "claude-sonnet-4-6" }));
registry.register(new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY! }));
registry.register(new OllamaProvider({ baseUrl: "http://localhost:11434" }));

// Route automatically by model ID
const provider = registry.resolve("llama3.2:3b");   // → OllamaProvider
const provider2 = registry.resolve("claude-sonnet-4-6"); // → ClaudeCliProvider
const provider3 = registry.resolve("openrouter/meta-llama/llama-3.3-70b-instruct:free"); // → OpenRouterProvider

// Same API regardless of provider
const response = await provider.complete({
  model: "llama3.2:3b",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.content[0].text);
```

### Streaming

```typescript
const cancel = provider.stream(request, {
  onEvent: (sse) => process.stdout.write(sse),
  onDone: (result) => console.log("done:", result.assistantText),
  onError: (err) => console.error(err),
});

// Cancel anytime
cancel();
```

### List all models

```typescript
const models = await registry.listAllModels();
// [{ id: "claude-sonnet-4-6", provider: "claude-cli", ... },
//  { id: "llama3.2:3b", provider: "ollama", ... }, ...]
```

### Use a provider directly

```typescript
const ollama = new OllamaProvider({ baseUrl: "http://gpu-box:11434" });
const response = await ollama.complete({
  model: "mistral:7b",
  messages: [{ role: "user", content: "Hello" }],
});

// OpenRouter — free cloud models, no GPU needed
const openrouter = new OpenRouterProvider({ apiKey: "sk-or-..." });
const response2 = await openrouter.complete({
  model: "meta-llama/llama-3.3-70b-instruct:free",
  messages: [{ role: "user", content: "Hello" }],
});
```

### Custom providers

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

## Low-level CLI access

For full control over the Claude CLI process:

```typescript
import { spawnClaude } from "@anagnole/claude-cli-wrapper";

const child = spawnClaude({
  prompt: "Fix the auth bug",
  model: "claude-sonnet-4-6",
  streaming: false,
  systemPrompt: "You are a senior engineer.",
  permissionMode: "bypassPermissions",
  allowedTools: ["Bash(git *)", "Read", "Edit"],
  mcpConfig: "/path/to/mcp-config.json",
  workingDirectory: "/path/to/project",
  maxTurns: 10,
  maxBudgetUsd: 1.00,
});
```

## Subpath imports

```typescript
import { spawnClaude } from "@anagnole/claude-cli-wrapper/cli";
import { NdjsonParser } from "@anagnole/claude-cli-wrapper/parser";
import { SessionMap } from "@anagnole/claude-cli-wrapper/session";
import { ProviderRegistry } from "@anagnole/claude-cli-wrapper/provider";
import type { MessagesRequest } from "@anagnole/claude-cli-wrapper/types";
```

## All exports

```typescript
// Providers
ProviderRegistry, ClaudeCliProvider, OllamaProvider, OpenRouterProvider
Provider, ModelInfo, ProviderStreamCallbacks  // types
ClaudeCliProviderOptions, OllamaProviderConfig, OpenRouterProviderConfig // types

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

## Companion: API server

This package also comes with a companion HTTP server (`@anagnole/claude-api-server`) that wraps the provider registry as an Anthropic Messages API-compatible endpoint. See the [monorepo README](https://github.com/anagnole/claude-api) for details.
