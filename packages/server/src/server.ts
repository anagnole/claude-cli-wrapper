import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { messagesRoute } from "./routes/messages.js";
import { modelsRoute } from "./routes/models.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(messagesRoute);
await app.register(modelsRoute);

app.get("/health", async () => ({ status: "ok" }));

await app.listen({ port: config.port, host: config.host });
app.log.info(`claude-api proxy listening on http://${config.host}:${config.port}`);
