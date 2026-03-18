// --- Anthropic Messages API types ---

export interface ContentBlock {
  type: string;
  text?: string;
  // tool_use fields
  id?: string;
  name?: string;
  input?: unknown;
  // tool_result fields
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: string };
}

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface MessagesRequest {
  model: string;
  messages: MessageParam[];
  max_tokens?: number;
  system?: string | SystemBlock[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: unknown[];
  tool_choice?: unknown;
  thinking?: unknown;
  metadata?: { user_id?: string };

  // --- Standard extensions ---
  effort?: string;
  json_schema?: unknown;

  // --- CLI extensions (all optional) ---
  // These map directly to Claude CLI flags.
  // Pass them in the request body alongside standard Anthropic params.

  /** Permission mode: "plan" | "bypassPermissions" | etc. Maps to --permission-mode */
  permission_mode?: string;
  /** Tools to auto-approve without prompting. Maps to --allowedTools */
  allowed_tools?: string[];
  /** Tools to remove from context entirely. Maps to --disallowedTools */
  disallowed_tools?: string[];
  /** Restrict built-in tools. "" disables all, "default" for all. Maps to --tools */
  cli_tools?: string;
  /** Path to MCP server config JSON file. Maps to --mcp-config */
  mcp_config?: string;
  /** Use only MCP servers from mcp_config, ignore all others. Maps to --strict-mcp-config */
  strict_mcp_config?: boolean;
  /** Run in isolated git worktree. Maps to --worktree */
  worktree?: string;
  /** Working directory for the CLI process. Maps to cwd */
  working_directory?: string;
  /** Max agentic turns before stopping. Maps to --max-turns */
  max_turns?: number;
  /** Max dollar spend before stopping. Maps to --max-budget-usd */
  max_budget_usd?: number;
  /** Append to default system prompt instead of replacing. Maps to --append-system-prompt */
  append_system_prompt?: boolean;
  /** Continue most recent conversation. Maps to --continue */
  continue_conversation?: boolean;
  /** Resume a specific CLI session by ID. Maps to --resume */
  resume_session_id?: string;
  /** Fork the session (new ID) when resuming. Maps to --fork-session */
  fork_session?: boolean;
  /** Fallback model if primary is overloaded. Maps to --fallback-model */
  fallback_model?: string;
  /** Skip all permission prompts. Maps to --dangerously-skip-permissions */
  dangerously_skip_permissions?: boolean;
  /** Additional working directories. Maps to --add-dir */
  add_dirs?: string[];
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface MessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  stop_sequence: string | null;
  usage: Usage;
  // CLI extras returned in response
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

export interface ApiError {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

export function apiError(type: string, message: string): ApiError {
  return { type: "error", error: { type, message } };
}
