export interface RetryOptions {
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call fn until it succeeds, backing off exponentially between tries. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const base = opts.baseDelayMs ?? 200;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch {
      await sleep(base * 2 ** (attempt - 1));
    }
  }
}
