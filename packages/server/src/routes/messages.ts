import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ChildProcess } from "node:child_process";
import {
  NdjsonParser,
  SessionMap,
  spawnClaude,
  extractPrompt,
  extractSystem,
  warnUnsupported,
  buildResponse,
  createStreamState,
  transformEvent,
  apiError,
  type MessageParam,
  type MessagesRequest,
} from "@anagnole/claude-cli";
import { config } from "../config.js";

// Track active processes for abort support
const activeProcesses = new Map<string, ChildProcess>();

export const messagesRoute: FastifyPluginAsync = async (app) => {
  const sessionMap = new SessionMap();

  app.post("/v1/messages", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as MessagesRequest;

    if (!body.messages?.length) {
      return reply.code(400).send(apiError("invalid_request_error", "messages is required and must be non-empty"));
    }
    if (!body.model) {
      return reply.code(400).send(apiError("invalid_request_error", "model is required"));
    }

    warnUnsupported(body, request.log);

    let prompt: string;
    try {
      prompt = extractPrompt(body.messages);
    } catch (e) {
      return reply.code(400).send(apiError("invalid_request_error", (e as Error).message));
    }

    const system = extractSystem(body.system);
    const model = body.model ?? config.defaultModel;

    // Session lookup for multi-turn (unless caller explicitly provides resume_session_id)
    let resumeId = body.resume_session_id ?? null;
    if (!resumeId && !body.continue_conversation) {
      const contextHash = SessionMap.hashContext(body.messages);
      resumeId = sessionMap.lookup(contextHash, model);
    }

    if (resumeId) {
      request.log.info({ resumeId }, "resuming CLI session");
    }

    const spawnOpts = {
      prompt,
      model,
      claudePath: config.claudePath,
      systemPrompt: system,
      appendSystemPrompt: body.append_system_prompt,
      resumeSessionId: resumeId ?? undefined,
      continueConversation: body.continue_conversation,
      forkSession: body.fork_session,
      effort: body.effort,
      jsonSchema: body.json_schema,
      permissionMode: body.permission_mode,
      allowedTools: body.allowed_tools,
      disallowedTools: body.disallowed_tools,
      cliTools: body.cli_tools,
      mcpConfig: body.mcp_config,
      strictMcpConfig: body.strict_mcp_config,
      worktree: body.worktree,
      workingDirectory: body.working_directory,
      maxTurns: body.max_turns,
      maxBudgetUsd: body.max_budget_usd,
      fallbackModel: body.fallback_model,
      dangerouslySkipPermissions: body.dangerously_skip_permissions,
      addDirs: body.add_dirs,
    };

    if (body.stream) {
      return handleStreaming(request, reply, spawnOpts, sessionMap, body.messages);
    } else {
      return handleNonStreaming(request, reply, spawnOpts, sessionMap, body.messages);
    }
  });

  app.post<{ Params: { id: string } }>("/v1/messages/:id/cancel", async (request, reply) => {
    const proc = activeProcesses.get(request.params.id);
    if (!proc) {
      return reply.code(404).send(apiError("not_found_error", "No active process with that ID"));
    }
    proc.kill("SIGTERM");
    activeProcesses.delete(request.params.id);
    return reply.code(200).send({ type: "cancelled", id: request.params.id });
  });
};

async function handleNonStreaming(
  request: FastifyRequest,
  reply: FastifyReply,
  spawnOpts: Parameters<typeof spawnClaude>[0],
  sessionMap: SessionMap,
  messages: MessageParam[],
): Promise<void> {
  const child = spawnClaude({ ...spawnOpts, streaming: false });

  const requestId = request.id;
  activeProcesses.set(requestId, child);

  const chunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });

  activeProcesses.delete(requestId);

  const stdout = Buffer.concat(chunks).toString("utf-8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

  if (exitCode !== 0 || !stdout) {
    request.log.error({ exitCode, stderr }, "CLI process failed");
    return reply.code(500).send(apiError("api_error", stderr || "CLI process exited with error"));
  }

  let cliResult: Record<string, unknown>;
  try {
    cliResult = JSON.parse(stdout);
  } catch {
    request.log.error({ stdout: stdout.slice(0, 200) }, "Failed to parse CLI output");
    return reply.code(500).send(apiError("api_error", "Failed to parse CLI response"));
  }

  if (cliResult.is_error) {
    return reply.code(500).send(apiError("api_error", (cliResult.result as string) || "CLI returned an error"));
  }

  const response = buildResponse(cliResult as any, spawnOpts.model!);

  if (typeof cliResult.session_id === "string") {
    const fullMessages: MessageParam[] = [
      ...messages,
      { role: "assistant", content: response.content[0]?.text ?? "" },
    ];
    sessionMap.store(fullMessages, cliResult.session_id, spawnOpts.model!);
  }

  request.log.info({
    tokens: response.usage,
    cost: cliResult.total_cost_usd,
    duration: cliResult.duration_ms,
    turns: cliResult.num_turns,
    sessionId: cliResult.session_id,
  }, "request complete");

  return reply.send(response);
}

async function handleStreaming(
  request: FastifyRequest,
  reply: FastifyReply,
  spawnOpts: Parameters<typeof spawnClaude>[0],
  sessionMap: SessionMap,
  messages: MessageParam[],
): Promise<void> {
  const child = spawnClaude({ ...spawnOpts, streaming: true });

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const parser = new NdjsonParser();
  const state = createStreamState(spawnOpts.model!);

  activeProcesses.set(state.msgId, child);

  let assistantText = "";

  reply.raw.on("close", () => {
    if (!state.finished && child.exitCode === null) {
      request.log.info("client disconnected, killing CLI process");
      child.kill("SIGTERM");
      activeProcesses.delete(state.msgId);
    }
  });

  child.stdout!.on("data", (chunk: Buffer) => {
    const events = parser.feed(chunk.toString("utf-8"));
    for (const event of events) {
      const obj = event as Record<string, unknown>;
      const sseLines = transformEvent(obj, state);
      for (const line of sseLines) {
        reply.raw.write(line);
      }

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
    request.log.warn({ stderr: chunk.toString("utf-8").trim() }, "CLI stderr");
  });

  await new Promise<void>((resolve) => {
    child.on("close", (exitCode) => {
      const remaining = parser.flush();
      for (const event of remaining) {
        const obj = event as Record<string, unknown>;
        const sseLines = transformEvent(obj, state);
        for (const line of sseLines) {
          reply.raw.write(line);
        }
      }

      if (!state.finished) {
        reply.raw.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
      }

      activeProcesses.delete(state.msgId);

      if (state.sessionId && assistantText) {
        const fullMessages: MessageParam[] = [
          ...messages,
          { role: "assistant", content: assistantText },
        ];
        sessionMap.store(fullMessages, state.sessionId, spawnOpts.model!);
      }

      request.log.info({
        exitCode,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        sessionId: state.sessionId,
      }, "stream complete");

      reply.raw.end();
      resolve();
    });
  });
}
