import { AIError, mapGoogleError } from "./errors";

/** No queue: excess requests fail immediately. Shared by all default adapters. */
export class ConcurrencyGate {
  private active = 0;
  async run<T>(limit: number, operation: () => Promise<T>): Promise<T> {
    if (this.active >= limit) throw new AIError("AI_RATE_LIMIT");
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
    }
  }
}
export const processGate = new ConcurrencyGate();
export type RetryDependencies = {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};
export const defaultRetryDependencies: RetryDependencies = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};
export async function withRetries<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  deps: RetryDependencies,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const mapped = mapGoogleError(error);
      if (!(mapped instanceof AIError)) throw mapped;
      // Do not shorten long server delays: return to caller instead of sleeping indefinitely.
      if (
        !mapped.retryable ||
        attempt >= maxRetries ||
        (mapped.retryAfterMs ?? 0) > 30000
      ) {
        throw new AIError(mapped.code, { ...mapped, attempts: attempt + 1 });
      }
      const backoff =
        Math.min(8000, 500 * 2 ** attempt) * (0.5 + deps.random() * 0.5);
      await deps.sleep(Math.max(backoff, mapped.retryAfterMs ?? 0));
    }
  }
}
