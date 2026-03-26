import type { Provider, ModelInfo, ProviderStreamCallbacks } from "./types.js";
import type { MessagesRequest, MessagesResponse, MessageParam, SystemBlock } from "../types.js";
import { generateMsgId } from "../transform/response.js";
import { NdjsonParser } from "../cli/parser.js";

export interface OllamaProviderConfig {
  /** Ollama API base URL. Defaults to "http://localhost:11434". */
  baseUrl?: string;
  /**
   * Optional prefix for model IDs. For example, "ollama/" means model IDs
   * like "ollama/llama3.3:70b" route to this provider and the prefix is
   * stripped before calling Ollama. If empty, this provider acts as a
   * catch-all for any model ID not matched by earlier providers.
   */
  modelPrefix?: string;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: Record<string, unknown>;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
  }>;
}

export class OllamaProvider implements Provider {
  readonly name = "ollama";
  private baseUrl: string;
  private modelPrefix: string;

  constructor(config?: OllamaProviderConfig) {
    this.baseUrl = (config?.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    this.modelPrefix = config?.modelPrefix ?? "";
  }

  canHandle(model: string): boolean {
    if (this.modelPrefix) return model.startsWith(this.modelPrefix);
    return true; // catch-all when no prefix
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as OllamaTagsResponse;
    return data.models.map((m) => ({
      id: this.modelPrefix + m.name,
      display_name: m.name,
      created_at: m.modified_at,
      type: "model" as const,
      provider: this.name,
    }));
  }

  async complete(request: MessagesRequest): Promise<MessagesResponse> {
    const ollamaReq = this.toOllamaRequest(request, false);

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaReq),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    return this.fromOllamaResponse(data, request.model);
  }

  stream(request: MessagesRequest, callbacks: ProviderStreamCallbacks): () => void {
    const ollamaReq = this.toOllamaRequest(request, true);
    const controller = new AbortController();
    const model = request.model;

    const run = async () => {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaReq),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        callbacks.onError(new Error(`Ollama error (${res.status}): ${text}`));
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const parser = new NdjsonParser();
      const msgId = generateMsgId();

      let started = false;
      let assistantText = "";
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const events = parser.feed(chunk);

          for (const event of events) {
            const obj = event as OllamaChatResponse;

            if (!started) {
              started = true;
              // Emit message_start
              callbacks.onEvent(sse("message_start", {
                type: "message_start",
                message: {
                  id: msgId,
                  type: "message",
                  role: "assistant",
                  content: [],
                  model,
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              }));
              // Emit content_block_start
              callbacks.onEvent(sse("content_block_start", {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              }));
            }

            if (obj.message?.content) {
              assistantText += obj.message.content;
              callbacks.onEvent(sse("content_block_delta", {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: obj.message.content },
              }));
            }

            if (obj.done) {
              inputTokens = obj.prompt_eval_count ?? 0;
              outputTokens = obj.eval_count ?? 0;

              callbacks.onEvent(sse("content_block_stop", {
                type: "content_block_stop",
                index: 0,
              }));
              callbacks.onEvent(sse("message_delta", {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: outputTokens },
              }));
              callbacks.onEvent(sse("message_stop", { type: "message_stop" }));
            }
          }
        }

        // Flush remaining
        const remaining = parser.flush();
        for (const event of remaining) {
          const obj = event as OllamaChatResponse;
          if (obj.done && !started) {
            // Edge case: very short response in single chunk
          }
        }

        callbacks.onDone({ assistantText });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        callbacks.onError(err as Error);
      }
    };

    run().catch((err) => {
      if ((err as Error).name === "AbortError") return;
      callbacks.onError(err);
    });

    return () => controller.abort();
  }

  private stripPrefix(model: string): string {
    if (this.modelPrefix && model.startsWith(this.modelPrefix)) {
      return model.slice(this.modelPrefix.length);
    }
    return model;
  }

  private toOllamaRequest(request: MessagesRequest, stream: boolean): OllamaChatRequest {
    const messages: OllamaMessage[] = [];

    // System prompt
    const system = extractSystemString(request.system);
    if (system) {
      messages.push({ role: "system", content: system });
    }

    // Convert message history
    for (const msg of request.messages) {
      messages.push({
        role: msg.role,
        content: typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("\n"),
      });
    }

    const options: Record<string, unknown> = {};
    if (request.temperature != null) options.temperature = request.temperature;
    if (request.top_p != null) options.top_p = request.top_p;
    if (request.top_k != null) options.top_k = request.top_k;
    if (request.stop_sequences?.length) options.stop = request.stop_sequences;
    if (request.max_tokens != null) options.num_predict = request.max_tokens;

    return {
      model: this.stripPrefix(request.model),
      messages,
      stream,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  }

  private fromOllamaResponse(data: OllamaChatResponse, model: string): MessagesResponse {
    return {
      id: generateMsgId(),
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: data.message.content }],
      model,
      stop_reason: data.done ? "end_turn" : null,
      stop_sequence: null,
      usage: {
        input_tokens: data.prompt_eval_count ?? 0,
        output_tokens: data.eval_count ?? 0,
      },
    };
  }
}

/** Format a single SSE event. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Flatten system prompt to a single string. */
function extractSystemString(system: string | SystemBlock[] | undefined): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
