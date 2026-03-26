import type { Provider, ModelInfo } from "./types.js";

export class ProviderRegistry {
  private providers: Provider[] = [];

  /** Register a provider. First registered = highest priority for model routing. */
  register(provider: Provider): void {
    this.providers.push(provider);
  }

  /** Find the first provider that can handle the given model ID. */
  resolve(model: string): Provider | null {
    return this.providers.find((p) => p.canHandle(model)) ?? null;
  }

  /** Merge model lists from all registered providers. */
  async listAllModels(): Promise<ModelInfo[]> {
    const results = await Promise.allSettled(
      this.providers.map((p) => p.listModels()),
    );
    return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  }
}
