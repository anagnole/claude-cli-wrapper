import type { FastifyPluginAsync } from "fastify";
import type { ProviderRegistry } from "@anagnole/claude-cli-wrapper";

export const modelsRoute: FastifyPluginAsync = async (app) => {
  app.get("/v1/models", async () => {
    const registry = (app as any).providers as ProviderRegistry;
    const models = await registry.listAllModels();
    return {
      data: models,
      has_more: false,
      first_id: models[0]?.id ?? "",
      last_id: models[models.length - 1]?.id ?? "",
    };
  });

  app.get<{ Params: { model_id: string } }>("/v1/models/:model_id", async (request, reply) => {
    const registry = (app as any).providers as ProviderRegistry;
    const models = await registry.listAllModels();
    const model = models.find((m) => m.id === request.params.model_id);
    if (!model) {
      return reply.code(404).send({
        type: "error",
        error: { type: "not_found_error", message: "Model not found" },
      });
    }
    return model;
  });
};
