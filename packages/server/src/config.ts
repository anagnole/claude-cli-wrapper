export const config = {
  port: parseInt(process.env.CLAUDE_API_PORT ?? "4301", 10),
  host: process.env.CLAUDE_API_HOST ?? "127.0.0.1",
  claudePath: process.env.CLAUDE_PATH ?? "claude",
  defaultModel: "claude-sonnet-4-6",
  // Ollama
  ollamaEnabled: process.env.OLLAMA_ENABLED !== "false",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  ollamaModelPrefix: process.env.OLLAMA_MODEL_PREFIX ?? "",
};
