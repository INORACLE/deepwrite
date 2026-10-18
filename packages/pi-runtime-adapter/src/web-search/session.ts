import { createHash } from "node:crypto";
import {
  WEB_SEARCH_PROVIDERS,
  type WebSearchProviderId,
  type WebSearchRuntimeConfig
} from "@deepwrite/contracts";
import { fauxWebSearchClient } from "./providers/faux";
import { webSearchClient } from "./registry";
import {
  sharedWebSearchRateLimiter,
  type WebSearchRateLimiter
} from "./rate-limiter";
import {
  WebSearchProviderError,
  type WebSearchFetch,
  type WebSearchHit,
  type WebSearchProviderClient,
  type WebSearchRequest
} from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;
/** First try plus two retries. */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];
const MAX_RETRY_DELAY_MS = 10_000;
const JITTER_MS = 250;

/** The run's search budget is spent; the model is told to work with what it has. */
export class WebSearchLimitError extends Error {
  constructor(readonly callLimit: number) {
    super(`web search limit of ${callLimit} calls reached`);
    this.name = "WebSearchLimitError";
  }
}

export interface WebSearchOutcome {
  hits: WebSearchHit[];
  /** Answered from this run's cache; no request was sent and none counted. */
  cached: boolean;
  /** Requests sent so far this run, including this one unless cached. */
  callIndex: number;
  callLimit: number;
}

export interface WebSearchSession {
  readonly providerId: WebSearchProviderId;
  readonly maxResults: number;
  readonly queryHint: string;
  search(
    request: WebSearchRequest,
    signal?: AbortSignal
  ): Promise<WebSearchOutcome>;
}

export interface CreateWebSearchSessionOptions {
  fetch?: WebSearchFetch;
  /** Replaces the registered client; tests and the local Faux runtime use it. */
  client?: WebSearchProviderClient;
  localFaux?: boolean;
  limiter?: WebSearchRateLimiter;
  /** The run's own abort signal; it stops the search and any waiting. */
  signal?: AbortSignal;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function cacheKey(request: WebSearchRequest): string {
  return `${request.query.trim().replace(/\s+/gu, " ").toLowerCase()}|${request.count}`;
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
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
 * One search budget for a whole run: the main agent and its subagents share
 * the call limit, the result cache and, through the process limiter, the
 * service's rate limit.
 */
export function createWebSearchSession(
  config: WebSearchRuntimeConfig,
  options: CreateWebSearchSessionOptions = {}
): WebSearchSession {
  const client =
    options.client ??
    (options.localFaux
      ? fauxWebSearchClient
      : webSearchClient(config.providerId));
  const maxResults = Math.min(
    config.maxResults,
    WEB_SEARCH_PROVIDERS[config.providerId].maxResultsCap
  );
  const limiter = options.limiter ?? sharedWebSearchRateLimiter;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  // The key never appears in the limiter's bookkeeping, only its fingerprint.
  const limiterKey = `${config.providerId}:${createHash("sha256")
    .update(config.apiKey)
    .digest("hex")
    .slice(0, 16)}`;
  const cache = new Map<string, Promise<WebSearchHit[]>>();
  let calls = 0;

  function aborted(signal?: AbortSignal): AbortSignal | undefined {
    return [options.signal, signal].find((entry) => entry?.aborted);
  }

  async function attempt(
    request: WebSearchRequest,
    signal?: AbortSignal
  ): Promise<WebSearchHit[]> {
    const outer = [options.signal, signal].filter(
      (entry): entry is AbortSignal => entry !== undefined
    );
    for (let tried = 0; ; tried += 1) {
      const stopped = aborted(signal);
      if (stopped) throw abortReason(stopped);
      let failure: WebSearchProviderError;
      try {
        await limiter.acquire(
          limiterKey,
          client.maxQps,
          outer.length ? AbortSignal.any(outer) : undefined
        );
        return await client.search(request, {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          fetch: options.fetch ?? fetch,
          signal: AbortSignal.any([...outer, AbortSignal.timeout(timeoutMs)])
        });
      } catch (error) {
        const stoppedNow = aborted(signal);
        if (stoppedNow) throw abortReason(stoppedNow);
        if (error instanceof WebSearchProviderError) failure = error;
        else if (isAbortLike(error))
          failure = new WebSearchProviderError("timeout", true);
        else throw error;
      }
      const delay = retryDelays[tried];
      if (!failure.retryable || delay === undefined) throw failure;
      await sleep(
        Math.min(
          MAX_RETRY_DELAY_MS,
          failure.retryAfterMs ?? delay + Math.floor(random() * JITTER_MS)
        ),
        outer.length ? AbortSignal.any(outer) : undefined
      );
    }
  }

  return {
    providerId: config.providerId,
    maxResults,
    queryHint: client.queryHint,
    async search(request, signal) {
      const key = cacheKey(request);
      const cached = cache.get(key);
      if (cached) {
        return {
          hits: await cached,
          cached: true,
          callIndex: calls,
          callLimit: config.perRunCallLimit
        };
      }
      if (calls >= config.perRunCallLimit)
        throw new WebSearchLimitError(config.perRunCallLimit);
      const callIndex = ++calls;
      // Stored while in flight, so parallel subagents asking the same thing share one request.
      const pending = attempt(request, signal).then((hits) =>
        hits.slice(0, request.count)
      );
      cache.set(key, pending);
      try {
        return {
          hits: await pending,
          cached: false,
          callIndex,
          callLimit: config.perRunCallLimit
        };
      } catch (error) {
        // A failed or aborted search is never remembered.
        if (cache.get(key) === pending) cache.delete(key);
        throw error;
      }
    }
  };
}
