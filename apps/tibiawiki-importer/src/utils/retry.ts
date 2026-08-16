export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

/** Executa fn() com retry exponencial + jitter. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    retries,
    baseDelayMs = 1000,
    factor = 2,
    maxDelayMs = 15000,
    onRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      const base = Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, attempt));
      const delay = Math.round(base * (0.5 + Math.random()));
      onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}