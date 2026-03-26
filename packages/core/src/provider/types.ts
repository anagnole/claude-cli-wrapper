import type { MessagesRequest, MessagesResponse } from "../types.js";

export interface ModelInfo {
  id: string;
  display_name: string;
  created_at: string;
  type: "model";
  provider: string;
}

export interface ProviderStreamCallbacks {
  /** Called for each SSE-formatted string to write to the response. */
  onEvent: (sse: string) => void;
  /** Called when the stream completes successfully. */
  onDone: (result: { sessionId?: string; assistantText: string }) => void;
  /** Called on stream error. */
  onError: (error: Error) => void;
}

export interface Provider {
  readonly name: string;

  /** Return true if this provider can handle the given model ID. */
  canHandle(model: string): boolean;

  /** List models this provider offers. */
  listModels(): Promise<ModelInfo[]>;

  /** Non-streaming completion. */
  complete(request: MessagesRequest): Promise<MessagesResponse>;

  /**
   * Streaming completion. Writes SSE events via callbacks.
   * Returns a cancel function to abort the request.
   */
  stream(request: MessagesRequest, callbacks: ProviderStreamCallbacks): () => void;
}
