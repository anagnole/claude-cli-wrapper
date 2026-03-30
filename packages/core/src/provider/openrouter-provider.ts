import type { Provider, ModelInfo, ProviderStreamCallbacks } from "./types.js";
import type { MessagesRequest, MessagesResponse, SystemBlock } from "../types.js";
import { generateMsgId } from "../transform/response.js";

export interface OpenRouterProviderConfig {
  /** OpenRouter API key. Required. */
  apiKey: string;
  /**
   * Optional prefix for model IDs. For example, "openrouter/" means model IDs
   * like "openrouter/meta-llama/llama-3.3-70b-instruct:free" route to this
   * provider and the prefix is stripped before calling OpenRouter.
   * Defaults to "openrouter/".
   */
  modelPrefix?: string;
  /** OpenRouter API base URL. Defaults to "https://openrouter.ai/api/v1". */
  baseUrl?: string;
  /** Only list free models. Defaults to true. */
  freeOnly?: boolean;
}

// OpenRouter uses the OpenAI chat completions format.

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

interface OpenAIChoice {
  index: number;
  message?: { role: string; content: string };
  delta?: { role?: string; content?: string };
  finish_reason: string | null;
}

interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: OpenAIChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenRouterModel {
  id: string;
  name: string;
  created: number;
  pricing: { prompt: string; completion: string };
}

export class OpenRouterProvider implements Provider {
  readonly name = "openrouter";
  private apiKey: string;
  private modelPrefix: string;
  private baseUrl: string;
  private freeOnly: boolean;

  constructor(config: OpenRouterProviderConfig) {
    this.apiKey = config.apiKey;
    this.modelPrefix = config.modelPrefix ?? "openrouter/";
    this.baseUrl = (config.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    this.freeOnly = config.freeOnly ?? true;
  }

  canHandle(model: string): boolean {
    if (this.modelPrefix) return model.startsWith(this.modelPrefix);
    return true;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { data: OpenRouterModel[] };
    let models = data.data;

    if (this.freeOnly) {
      models = models.filter(
        (m) => m.pricing.prompt === "0" && m.pricing.completion === "0",
      );
    }

    return models.map((m) => ({
      id: this.modelPrefix + m.id,
      display_name: m.name,
      created_at: new Date(m.created * 1000).toISOString(),
      type: "model" as const,
      provider: this.name,
    }));
  }

  async complete(request: MessagesRequest): Promise<MessagesResponse> {
    const body = this.toOpenAIRequest(request, false);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    return this.fromOpenAIResponse(data, request.model);
  }

  stream(request: MessagesRequest, callbacks: ProviderStreamCallbacks): () => void {
    const body = this.toOpenAIRequest(request, true);
    const controller = new AbortController();
    const model = request.model;

    const run = async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        callbacks.onError(new Error(`OpenRouter error (${res.status}): ${text}`));
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const msgId = generateMsgId();

      let started = false;
      let finished = false;
      let assistantText = "";
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!; // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            let chunk: OpenAIChatResponse;
            try {
              chunk = JSON.parse(payload) as OpenAIChatResponse;
            } catch {
              continue;
            }

            const delta = chunk.choices?.[0]?.delta;
            const finishReason = chunk.choices?.[0]?.finish_reason;

            if (!started) {
              started = true;
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
              callbacks.onEvent(sse("content_block_start", {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              }));
            }

            if (delta?.content) {
              assistantText += delta.content;
              callbacks.onEvent(sse("content_block_delta", {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: delta.content },
              }));
            }

            if (finishReason && !finished) {
              finished = true;
              const stopReason = finishReason === "length" ? "max_tokens" : "end_turn";
              callbacks.onEvent(sse("content_block_stop", {
                type: "content_block_stop",
                index: 0,
              }));
              callbacks.onEvent(sse("message_delta", {
                type: "message_delta",
                delta: { stop_reason: stopReason, stop_sequence: null },
                usage: { output_tokens: 0 },
              }));
              callbacks.onEvent(sse("message_stop", { type: "message_stop" }));
            }
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

  private toOpenAIRequest(request: MessagesRequest, stream: boolean): OpenAIChatRequest {
    const messages: OpenAIMessage[] = [];

    const system = extractSystemString(request.system);
    if (system) {
      messages.push({ role: "system", content: system });
    }

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

    const req: OpenAIChatRequest = {
      model: this.stripPrefix(request.model),
      messages,
      stream,
    };

    if (request.max_tokens != null) req.max_tokens = request.max_tokens;
    if (request.temperature != null) req.temperature = request.temperature;
    if (request.top_p != null) req.top_p = request.top_p;
    if (request.stop_sequences?.length) req.stop = request.stop_sequences;

    return req;
  }

  private fromOpenAIResponse(data: OpenAIChatResponse, model: string): MessagesResponse {
    const text = data.choices?.[0]?.message?.content ?? "";
    const finishReason = data.choices?.[0]?.finish_reason;

    return {
      id: generateMsgId(),
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      model,
      stop_reason: finishReason === "length" ? "max_tokens" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function extractSystemString(system: string | SystemBlock[] | undefined): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
