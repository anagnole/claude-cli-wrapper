import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  ProviderRegistry,
  ClaudeCliProvider,
  OllamaProvider,
  OpenRouterProvider,
} from "@anagnole/claude-cli-wrapper";
import { config } from "./config.js";
import { messagesRoute } from "./routes/messages.js";
import { modelsRoute } from "./routes/models.js";

// Build provider registry
const registry = new ProviderRegistry();

registry.register(
  new ClaudeCliProvider({
    claudePath: config.claudePath,
    defaultModel: config.defaultModel,
  }),
);

if (config.ollamaEnabled) {
  registry.register(
    new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      modelPrefix: config.ollamaModelPrefix,
    }),
  );
}

if (config.openrouterEnabled) {
  registry.register(
    new OpenRouterProvider({
      apiKey: config.openrouterApiKey,
      modelPrefix: config.openrouterModelPrefix,
      freeOnly: config.openrouterFreeOnly,
    }),
  );
}

const app = Fastify({ logger: true });

// Make registry available to routes
app.decorate("providers", registry);

await app.register(cors, { origin: true });
await app.register(messagesRoute);
await app.register(modelsRoute);

app.get("/health", async () => ({ status: "ok" }));

await app.listen({ port: config.port, host: config.host });
app.log.info(`claude-api proxy listening on http://${config.host}:${config.port}`);
