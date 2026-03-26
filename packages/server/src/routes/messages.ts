import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  type ProviderRegistry,
  type MessagesRequest,
  apiError,
  warnUnsupported,
} from "@anagnole/claude-cli-wrapper";

// Track active cancel functions for abort support
const activeCancels = new Map<string, () => void>();

export const messagesRoute: FastifyPluginAsync = async (app) => {
  app.post("/v1/messages", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as MessagesRequest;

    if (!body.messages?.length) {
      return reply.code(400).send(apiError("invalid_request_error", "messages is required and must be non-empty"));
    }
    if (!body.model) {
      return reply.code(400).send(apiError("invalid_request_error", "model is required"));
    }

    const registry = (app as any).providers as ProviderRegistry;
    const provider = registry.resolve(body.model);
    if (!provider) {
      return reply.code(400).send(apiError("invalid_request_error", `No provider found for model: ${body.model}`));
    }

    warnUnsupported(body, request.log);

    if (body.stream) {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const requestId = request.id;
      const cancel = provider.stream(body, {
        onEvent: (sse) => reply.raw.write(sse),
        onDone: (result) => {
          activeCancels.delete(requestId);
          request.log.info(
            { provider: provider.name, sessionId: result.sessionId },
            "stream complete",
          );
          reply.raw.end();
        },
        onError: (err) => {
          activeCancels.delete(requestId);
          request.log.error({ err }, "stream error");
          reply.raw.end();
        },
      });

      activeCancels.set(requestId, cancel);

      reply.raw.on("close", () => {
        const fn = activeCancels.get(requestId);
        if (fn) {
          request.log.info("client disconnected, cancelling");
          fn();
          activeCancels.delete(requestId);
        }
      });
    } else {
      try {
        const response = await provider.complete(body);
        request.log.info(
          { provider: provider.name, tokens: response.usage, sessionId: response.session_id },
          "request complete",
        );
        return reply.send(response);
      } catch (err) {
        request.log.error({ err }, "provider error");
        return reply.code(500).send(apiError("api_error", (err as Error).message));
      }
    }
  });

  app.post<{ Params: { id: string } }>("/v1/messages/:id/cancel", async (request, reply) => {
    const cancel = activeCancels.get(request.params.id);
    if (!cancel) {
      return reply.code(404).send(apiError("not_found_error", "No active request with that ID"));
    }
    cancel();
    activeCancels.delete(request.params.id);
    return reply.code(200).send({ type: "cancelled", id: request.params.id });
  });
};
