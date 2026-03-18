import type { FastifyPluginAsync } from "fastify";

const MODELS = [
  { id: "claude-opus-4-6", display_name: "Claude Opus 4.6", created_at: "2025-05-01T00:00:00Z", type: "model" as const },
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", created_at: "2025-05-01T00:00:00Z", type: "model" as const },
  { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", created_at: "2025-04-01T00:00:00Z", type: "model" as const },
];

export const modelsRoute: FastifyPluginAsync = async (app) => {
  app.get("/v1/models", async () => ({
    data: MODELS,
    has_more: false,
    first_id: MODELS[0].id,
    last_id: MODELS[MODELS.length - 1].id,
  }));

  app.get<{ Params: { model_id: string } }>("/v1/models/:model_id", async (request, reply) => {
    const model = MODELS.find((m) => m.id === request.params.model_id);
    if (!model) {
      return reply.code(404).send({ type: "error", error: { type: "not_found_error", message: "Model not found" } });
    }
    return model;
  });
};
