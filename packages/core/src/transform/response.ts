import crypto from "node:crypto";
import type { ContentBlock, MessagesResponse, Usage } from "../types.js";

export function generateMsgId(): string {
  return "msg_" + crypto.randomBytes(18).toString("base64url");
}

interface CliResult {
  result: string;
  stop_reason?: string;
  session_id: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export function buildResponse(cli: CliResult, model: string): MessagesResponse {
  const usage: Usage = {
    input_tokens: cli.usage?.input_tokens ?? 0,
    output_tokens: cli.usage?.output_tokens ?? 0,
  };
  if (cli.usage?.cache_creation_input_tokens) {
    usage.cache_creation_input_tokens = cli.usage.cache_creation_input_tokens;
  }
  if (cli.usage?.cache_read_input_tokens) {
    usage.cache_read_input_tokens = cli.usage.cache_read_input_tokens;
  }

  // Build content blocks — for now just text, but could include tool_use in the future
  const content: ContentBlock[] = [{ type: "text", text: cli.result }];

  return {
    id: generateMsgId(),
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: mapStopReason(cli.stop_reason),
    stop_sequence: null,
    usage,
    // CLI extras
    session_id: cli.session_id,
    cost_usd: cli.total_cost_usd,
    duration_ms: cli.duration_ms,
    num_turns: cli.num_turns,
  };
}

function mapStopReason(
  reason?: string,
): "end_turn" | "max_tokens" | "stop_sequence" {
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "stop_sequence") return "stop_sequence";
  return "end_turn";
}
