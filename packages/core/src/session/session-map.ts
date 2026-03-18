import { createHash } from "node:crypto";
import type { MessageParam } from "../types.js";

interface SessionEntry {
  cliSessionId: string;
  lastUsedAt: number;
  model: string;
}

export class SessionMap {
  private map = new Map<string, SessionEntry>();
  private maxEntries = 1000;

  /** Hash all messages except the last one to fingerprint the conversation context. */
  static hashContext(messages: MessageParam[]): string {
    const context = messages.slice(0, -1);
    if (context.length === 0) return "empty";
    const payload = JSON.stringify(context);
    return createHash("sha256").update(payload).digest("hex").slice(0, 16);
  }

  /** Look up a CLI session ID for a given context hash + model. */
  lookup(hash: string, model: string): string | null {
    const entry = this.map.get(hash);
    if (!entry || entry.model !== model) return null;
    entry.lastUsedAt = Date.now();
    return entry.cliSessionId;
  }

  /**
   * Store a session after a successful CLI invocation.
   * `fullMessages` should include the original messages + the assistant response,
   * so the *next* request with that history will find this session.
   */
  store(fullMessages: MessageParam[], cliSessionId: string, model: string): void {
    // The next request will hash messages[0..n-1] (all except its new user msg),
    // which equals the full messages from this turn.
    const nextHash = createHash("sha256")
      .update(JSON.stringify(fullMessages))
      .digest("hex")
      .slice(0, 16);

    this.map.set(nextHash, {
      cliSessionId,
      lastUsedAt: Date.now(),
      model,
    });

    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    if (this.map.size <= this.maxEntries) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.map) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.map.delete(oldestKey);
  }
}
