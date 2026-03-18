/** Buffers partial lines from a stream and yields complete parsed JSON objects. */
export class NdjsonParser {
  private buffer = "";

  feed(chunk: string): unknown[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    const results: unknown[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // Non-JSON line, skip
      }
    }
    return results;
  }

  flush(): unknown[] {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) return [];
    try {
      return [JSON.parse(remaining)];
    } catch {
      return [];
    }
  }
}
