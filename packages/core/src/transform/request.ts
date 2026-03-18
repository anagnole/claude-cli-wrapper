import type { MessageParam, MessagesRequest, SystemBlock } from "../types.js";

interface Logger {
  warn(msg: string): void;
}

/** Extract the text content from the last user message. */
export function extractPrompt(messages: MessageParam[]): string {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    throw new Error("Last message must have role 'user'");
  }
  if (typeof last.content === "string") return last.content;
  return last.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Flatten system prompt to a single string. */
export function extractSystem(
  system: string | SystemBlock[] | undefined,
): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Log warnings for API params the CLI truly can't handle. */
export function warnUnsupported(req: MessagesRequest, log: Logger): void {
  if (req.temperature != null) log.warn("temperature param ignored (CLI does not support it)");
  if (req.top_p != null) log.warn("top_p param ignored");
  if (req.top_k != null) log.warn("top_k param ignored");
  if (req.stop_sequences?.length) log.warn("stop_sequences param ignored");
  if (req.tools?.length) log.warn("tools param ignored (CLI uses its own built-in tools, use allowed_tools/disallowed_tools instead)");
  if (req.tool_choice != null) log.warn("tool_choice param ignored");
}
