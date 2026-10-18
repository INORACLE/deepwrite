const IDLE_FORGET_MS = 60_000;
const FORGET_THRESHOLD = 64;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

export interface WebSearchRateLimiterOptions {
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Spaces requests per key at least `1000 / qps` ms apart, so no one-second
 * window can hold more than `qps` of them. Shared by every run in the process,
 * because the service limits the key, not the conversation.
 */
export class WebSearchRateLimiter {
  private readonly nextSlot = new Map<string, number>();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: WebSearchRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Resolves when the caller may send its request. */
  async acquire(key: string, qps: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortReason(signal);
    const now = this.now();
    this.forgetIdle(now);
    const start = Math.max(now, this.nextSlot.get(key) ?? 0);
    this.nextSlot.set(key, start + 1000 / qps);
    if (start > now) await this.sleep(start - now, signal);
  }

  private forgetIdle(now: number): void {
    if (this.nextSlot.size < FORGET_THRESHOLD) return;
    for (const [key, slot] of this.nextSlot)
      if (slot < now - IDLE_FORGET_MS) this.nextSlot.delete(key);
  }
}

export const sharedWebSearchRateLimiter = new WebSearchRateLimiter();
