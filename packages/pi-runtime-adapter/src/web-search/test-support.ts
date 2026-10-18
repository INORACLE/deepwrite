import type { WebSearchRuntimeConfig } from "@deepwrite/contracts";
import { WebSearchRateLimiter } from "./rate-limiter";
import type {
  WebSearchHit,
  WebSearchProviderClient,
  WebSearchRequest
} from "./types";

export const TEST_KEY = "invalid-test-search-key";

export function runtimeConfig(
  overrides: Partial<WebSearchRuntimeConfig> = {}
): WebSearchRuntimeConfig {
  return {
    providerId: "deepseek",
    baseUrl: "https://search.example.test",
    apiKey: TEST_KEY,
    maxResults: 8,
    perRunCallLimit: 20,
    ...overrides
  };
}

export function hit(
  index: number,
  overrides: Partial<WebSearchHit> = {}
): WebSearchHit {
  return {
    title: `结果 ${index}`,
    url: `https://example.test/${index}`,
    siteName: "示例站",
    publishedAt: "2026-06-01T00:00:00+00:00",
    snippet: `短摘要 ${index}`,
    summary: `长摘要 ${index}`,
    ...overrides
  };
}

export type Step =
  | WebSearchHit[]
  | Error
  | ((request: WebSearchRequest) => Promise<WebSearchHit[]>);

/** A client that plays its steps in order and remembers what it was asked. */
export function scriptedClient(
  steps: Step[]
): WebSearchProviderClient & { requests: WebSearchRequest[] } {
  const requests: WebSearchRequest[] = [];
  let next = 0;
  return {
    id: "deepseek",
    maxQps: 5,
    queryHint: "测试语法提示。",
    requests,
    async search(request) {
      requests.push(request);
      const step = steps[Math.min(next++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return typeof step === "function" ? step(request) : step;
    }
  };
}

/** Never waits: the limiter's own timing is tested separately. */
export function instantLimiter(): WebSearchRateLimiter {
  return new WebSearchRateLimiter({
    now: () => 0,
    sleep: async () => undefined
  });
}

export function recordingSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    }
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
