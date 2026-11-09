export interface RetryOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
}

/** Thrown when every attempt failed; `cause` is the last error. */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  constructor(attempts: number, cause: unknown) {
    super(`gave up after ${attempts} attempts`, { cause });
    this.attempts = attempts;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call fn until it succeeds, backing off exponentially, at most maxAttempts times. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const base = opts.baseDelayMs ?? 200;
  const max = opts.maxAttempts ?? 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= max) throw new RetryExhaustedError(attempt, err);
      await sleep(base * 2 ** (attempt - 1));
    }
  }
}
