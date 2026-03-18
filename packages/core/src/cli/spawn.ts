import { spawn, type ChildProcess } from "node:child_process";

export interface SpawnOptions {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  appendSystemPrompt?: boolean;
  resumeSessionId?: string;
  continueConversation?: boolean;
  forkSession?: boolean;
  streaming: boolean;
  effort?: string;
  jsonSchema?: unknown;

  // CLI-specific options
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  cliTools?: string;
  mcpConfig?: string;
  strictMcpConfig?: boolean;
  worktree?: string;
  workingDirectory?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  dangerouslySkipPermissions?: boolean;
  addDirs?: string[];

  /** Path to the claude CLI binary. Defaults to "claude". */
  claudePath?: string;
}

export function spawnClaude(options: SpawnOptions): ChildProcess {
  const args = ["--print"];

  // Output format
  if (options.streaming) {
    args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  } else {
    args.push("--output-format", "json");
  }

  // Model
  if (options.model) args.push("--model", options.model);
  if (options.fallbackModel) args.push("--fallback-model", options.fallbackModel);

  // System prompt
  if (options.systemPrompt) {
    if (options.appendSystemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    } else {
      args.push("--system-prompt", options.systemPrompt);
    }
  }

  // Session management
  if (options.resumeSessionId) args.push("--resume", options.resumeSessionId);
  if (options.continueConversation) args.push("--continue");
  if (options.forkSession) args.push("--fork-session");

  // Effort & structured output
  if (options.effort) args.push("--effort", options.effort);
  if (options.jsonSchema) args.push("--json-schema", JSON.stringify(options.jsonSchema));

  // Permission & tools
  if (options.permissionMode) args.push("--permission-mode", options.permissionMode);
  if (options.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
  if (options.allowedTools?.length) args.push("--allowedTools", ...options.allowedTools);
  if (options.disallowedTools?.length) args.push("--disallowedTools", ...options.disallowedTools);
  if (options.cliTools != null) args.push("--tools", options.cliTools);

  // MCP
  if (options.mcpConfig) args.push(`--mcp-config=${options.mcpConfig}`);
  if (options.strictMcpConfig) args.push("--strict-mcp-config");

  // Worktree & directories
  if (options.worktree) args.push("--worktree", options.worktree);
  if (options.addDirs?.length) args.push("--add-dir", ...options.addDirs);

  // Safety limits
  if (options.maxTurns != null) args.push("--max-turns", String(options.maxTurns));
  if (options.maxBudgetUsd != null) args.push("--max-budget-usd", String(options.maxBudgetUsd));

  // Prompt is always last
  if (options.prompt) {
    args.push("--", options.prompt);
  }

  // Prevent recursion / interference if running inside a Claude Code session
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return spawn(options.claudePath ?? "claude", args, {
    cwd: options.workingDirectory,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
}
