// Bounded retry for transient network failures. Pure and injectable (sleep,
// jitter, fetch) so tests need neither real network nor real sleeping.

export interface RetryOptions {
  /** Max retries after the first attempt. */
  retries?: number;
  /** Backoff before retry N (ms); the last entry is reused if short. */
  delays?: number[];
  /** Whether a thrown error is worth retrying. */
  isRetryable?: (err: unknown) => boolean;
  /** Injected so tests don't really sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Extra random ms added to each delay (injected for determinism). */
  jitter?: () => number;
}

export const RETRY_DELAYS_MS = [250, 750];

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const realJitter = () => Math.floor(Math.random() * 100);

/** Run `fn`, retrying while `isRetryable(err)`. Throws the last error once exhausted. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const isRetryable = opts.isRetryable ?? isTransientError;
  const sleep = opts.sleep ?? realSleep;
  const jitter = opts.jitter ?? realJitter;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const base = delays[Math.min(attempt, delays.length - 1)] ?? 0;
      await sleep(base + jitter());
    }
  }
}

/** HTTP statuses worth retrying: 429 and any 5xx. Other 4xx never. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** A network-level failure (fetch threw: socket closed, ECONNRESET, timeout, DNS...). */
export function isTransientError(err: unknown): boolean {
  if (err instanceof RetryableStatusError) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && /^(ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR|ConnectionClosed|ConnectionRefused|FailedToOpenSocket)/.test(code)) {
    return true;
  }
  return /socket|connection (was )?(closed|reset|refused)|ECONNRESET|network|timed? ?out|fetch failed|terminated/i.test(err.message);
}

class RetryableStatusError extends Error {
  constructor(public response: Response) {
    super(`HTTP ${response.status}`);
  }
}

/**
 * fetch with bounded retries on network errors, timeouts, 5xx and 429. If the
 * attempts run out on a bad status, the last Response is returned so the caller
 * reports it exactly as before; if they run out on a thrown error, it is rethrown.
 * Never touches any cache: callers cache only the final, successful result.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  opts: RetryOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    return await withRetry(async () => {
      const res = await doFetch(url, init);
      if (isRetryableStatus(res.status)) throw new RetryableStatusError(res);
      return res;
    }, opts);
  } catch (err) {
    if (err instanceof RetryableStatusError) return err.response;
    throw err;
  }
}
