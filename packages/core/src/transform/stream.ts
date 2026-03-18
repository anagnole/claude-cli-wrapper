/**
 * Transforms CLI stream-json NDJSON events into Anthropic SSE format.
 *
 * The CLI's `--output-format stream-json --verbose` emits events like:
 *   {"type": "stream_event", "event": { ...anthropic_event... }, "session_id": "..."}
 *
 * The inner `event` payload is almost identical to the Anthropic SSE data.
 * We unwrap it, inject our msg_id where needed, and format as SSE lines.
 */

import { generateMsgId } from "./response.js";

/** Format a single SSE event. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface StreamState {
  msgId: string;
  model: string;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  started: boolean;
  finished: boolean;
}

export function createStreamState(model: string): StreamState {
  return {
    msgId: generateMsgId(),
    model,
    sessionId: null,
    inputTokens: 0,
    outputTokens: 0,
    started: false,
    finished: false,
  };
}

/**
 * Transform a parsed CLI NDJSON object into zero or more SSE strings.
 * Returns an array of SSE-formatted strings to write to the response.
 */
export function transformEvent(obj: Record<string, unknown>, state: StreamState): string[] {
  const results: string[] = [];

  // Capture session_id from any event
  if (typeof obj.session_id === "string") {
    state.sessionId = obj.session_id;
  }

  // stream_event wraps Anthropic-format events
  if (obj.type === "stream_event" && obj.event && typeof obj.event === "object") {
    const event = obj.event as Record<string, unknown>;
    const eventType = event.type as string;

    switch (eventType) {
      case "message_start": {
        state.started = true;
        // Rebuild message_start with our msg_id
        const msg = (event.message ?? {}) as Record<string, unknown>;
        const usage = (msg.usage ?? {}) as Record<string, unknown>;
        if (typeof usage.input_tokens === "number") state.inputTokens = usage.input_tokens;

        results.push(sse("message_start", {
          type: "message_start",
          message: {
            id: state.msgId,
            type: "message",
            role: "assistant",
            content: [],
            model: state.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: state.inputTokens, output_tokens: 1 },
          },
        }));
        break;
      }

      case "content_block_start":
        results.push(sse("content_block_start", event));
        break;

      case "content_block_delta":
        results.push(sse("content_block_delta", event));
        break;

      case "content_block_stop":
        results.push(sse("content_block_stop", event));
        break;

      case "message_delta": {
        const usage = (event.usage ?? {}) as Record<string, unknown>;
        if (typeof usage.output_tokens === "number") state.outputTokens = usage.output_tokens;
        results.push(sse("message_delta", event));
        break;
      }

      case "message_stop":
        state.finished = true;
        results.push(sse("message_stop", { type: "message_stop" }));
        break;

      default:
        // Pass through unknown event types (ping, etc.)
        if (eventType === "ping") {
          results.push(sse("ping", { type: "ping" }));
        }
        break;
    }
  }

  // result event — capture session_id and usage for session map
  if (obj.type === "result") {
    if (typeof obj.session_id === "string") state.sessionId = obj.session_id;
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (usage) {
      if (typeof usage.input_tokens === "number") state.inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === "number") state.outputTokens = usage.output_tokens;
    }
    // Don't emit SSE — message_stop was already sent by the stream events
  }

  return results;
}
