// CLI
export { spawnClaude } from "./cli/spawn.js";
export type { SpawnOptions } from "./cli/spawn.js";
export { NdjsonParser } from "./cli/parser.js";

// Session
export { SessionMap } from "./session/session-map.js";
export type { SessionLookup } from "./session/session-map.js";

// Transform
export { extractPrompt, extractSystem, warnUnsupported } from "./transform/request.js";
export { buildResponse, generateMsgId } from "./transform/response.js";
export { createStreamState, transformEvent } from "./transform/stream.js";
export type { StreamState } from "./transform/stream.js";

// Types
export type {
  ContentBlock,
  SystemBlock,
  MessageParam,
  MessagesRequest,
  MessagesResponse,
  Usage,
  ApiError,
} from "./types.js";
export { apiError } from "./types.js";
