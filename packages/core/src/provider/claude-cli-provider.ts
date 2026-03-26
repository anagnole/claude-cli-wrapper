import type { Provider, ModelInfo, ProviderStreamCallbacks } from "./types.js";
import type { MessagesRequest, MessagesResponse, MessageParam } from "../types.js";
import { apiError } from "../types.js";
import { spawnClaude, type SpawnOptions } from "../cli/spawn.js";
import { NdjsonParser } from "../cli/parser.js";
import { SessionMap } from "../session/session-map.js";
import { extractPrompt, extractSystem } from "../transform/request.js";
import { buildResponse, generateMsgId } from "../transform/response.js";
import { createStreamState, transformEvent } from "../transform/stream.js";

export interface ClaudeCliProviderOptions {
  /** Path to the claude CLI binary. Defaults to "claude". */
  claudePath?: string;
  /** Default model if none specified. Defaults to "claude-sonnet-4-6". */
  defaultModel?: string;
}

export class ClaudeCliProvider implements Provider {
  readonly name = "claude-cli";
  private sessionMap = new SessionMap();
  private claudePath: string;
  private defaultModel: string;

  constructor(options?: ClaudeCliProviderOptions) {
    this.claudePath = options?.claudePath ?? "claude";
    this.defaultModel = options?.defaultModel ?? "claude-sonnet-4-6";
  }

  canHandle(model: string): boolean {
    return model.startsWith("claude-");
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "claude-opus-4-6", display_name: "Claude Opus 4.6", created_at: "2025-05-01T00:00:00Z", type: "model", provider: this.name },
      { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", created_at: "2025-05-01T00:00:00Z", type: "model", provider: this.name },
      { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", created_at: "2025-04-01T00:00:00Z", type: "model", provider: this.name },
    ];
  }

  async complete(request: MessagesRequest): Promise<MessagesResponse> {
    const { spawnOpts, resumeId } = this.buildSpawnOptions(request);
    const child = spawnClaude({ ...spawnOpts, streaming: false });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });

    const stdout = Buffer.concat(chunks).toString("utf-8").trim();
    const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

    if (exitCode !== 0 || !stdout) {
      throw new Error(stderr || "CLI process exited with error");
    }

    let cliResult: Record<string, unknown>;
    try {
      cliResult = JSON.parse(stdout);
    } catch {
      throw new Error("Failed to parse CLI response");
    }

    if (cliResult.is_error) {
      throw new Error((cliResult.result as string) || "CLI returned an error");
    }

    const response = buildResponse(cliResult as any, spawnOpts.model!);

    // Store session for multi-turn
    if (typeof cliResult.session_id === "string") {
      const fullMessages: MessageParam[] = [
        ...request.messages,
        { role: "assistant", content: response.content[0]?.text ?? "" },
      ];
      this.sessionMap.store(fullMessages, cliResult.session_id, spawnOpts.model!, spawnOpts);
    }

    return response;
  }

  stream(request: MessagesRequest, callbacks: ProviderStreamCallbacks): () => void {
    const { spawnOpts } = this.buildSpawnOptions(request);
    const child = spawnClaude({ ...spawnOpts, streaming: true });

    const parser = new NdjsonParser();
    const state = createStreamState(spawnOpts.model!);
    let assistantText = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      const events = parser.feed(chunk.toString("utf-8"));
      for (const event of events) {
        const obj = event as Record<string, unknown>;
        const sseLines = transformEvent(obj, state);
        for (const line of sseLines) {
          callbacks.onEvent(line);
        }

        // Accumulate assistant text for session storage
        if (obj.type === "stream_event" && obj.event && typeof obj.event === "object") {
          const ev = obj.event as Record<string, unknown>;
          if (ev.type === "content_block_delta") {
            const delta = ev.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              assistantText += delta.text;
            }
          }
        }

        if (obj.type === "result" && typeof obj.result === "string" && !assistantText) {
          assistantText = obj.result;
        }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      // stderr is informational, not fatal during streaming
    });

    child.on("close", () => {
      const remaining = parser.flush();
      for (const event of remaining) {
        const obj = event as Record<string, unknown>;
        const sseLines = transformEvent(obj, state);
        for (const line of sseLines) {
          callbacks.onEvent(line);
        }
      }

      if (!state.finished) {
        callbacks.onEvent(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
      }

      // Store session for multi-turn
      if (state.sessionId && assistantText) {
        const fullMessages: MessageParam[] = [
          ...request.messages,
          { role: "assistant", content: assistantText },
        ];
        this.sessionMap.store(fullMessages, state.sessionId, spawnOpts.model!, spawnOpts);
      }

      callbacks.onDone({ sessionId: state.sessionId ?? undefined, assistantText });
    });

    // Return cancel function
    return () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    };
  }

  private buildSpawnOptions(request: MessagesRequest): {
    spawnOpts: SpawnOptions & { model: string };
    resumeId: string | null;
  } {
    const prompt = extractPrompt(request.messages);
    const system = extractSystem(request.system);
    const model = request.model ?? this.defaultModel;

    // Session lookup for multi-turn
    let resumeId = request.resume_session_id ?? null;
    let savedOptions: Record<string, unknown> = {};
    if (!resumeId && !request.continue_conversation) {
      const contextHash = SessionMap.hashContext(request.messages);
      const saved = this.sessionMap.lookup(contextHash, model);
      if (saved) {
        resumeId = saved.sessionId;
        savedOptions = saved.options;
      }
    }

    const spawnOpts = {
      ...savedOptions,
      prompt,
      model,
      claudePath: this.claudePath,
      systemPrompt: system,
      appendSystemPrompt: request.append_system_prompt,
      resumeSessionId: resumeId ?? undefined,
      continueConversation: request.continue_conversation,
      forkSession: request.fork_session,
      effort: request.effort,
      jsonSchema: request.json_schema,
      permissionMode: request.permission_mode,
      allowedTools: request.allowed_tools,
      disallowedTools: request.disallowed_tools,
      cliTools: request.cli_tools,
      mcpConfig: request.mcp_config,
      strictMcpConfig: request.strict_mcp_config,
      worktree: request.worktree,
      workingDirectory: request.working_directory,
      maxTurns: request.max_turns,
      maxBudgetUsd: request.max_budget_usd,
      fallbackModel: request.fallback_model,
      dangerouslySkipPermissions: request.dangerously_skip_permissions,
      addDirs: request.add_dirs,
      streaming: false as const, // overridden by caller
    };

    return { spawnOpts, resumeId };
  }
}
