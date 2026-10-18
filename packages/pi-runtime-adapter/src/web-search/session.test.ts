import { describe, expect, it, vi } from "vitest";
import { WebSearchRateLimiter } from "./rate-limiter";
import { WebSearchLimitError, createWebSearchSession } from "./session";
import {
  TEST_KEY,
  deferred,
  hit,
  instantLimiter,
  recordingSleep,
  runtimeConfig,
  scriptedClient
} from "./test-support";
import { WebSearchProviderError } from "./types";

function setup(
  steps: Parameters<typeof scriptedClient>[0],
  config = runtimeConfig(),
  options: Parameters<typeof createWebSearchSession>[1] = {}
) {
  const client = scriptedClient(steps);
  const sleeper = recordingSleep();
  const session = createWebSearchSession(config, {
    client,
    limiter: instantLimiter(),
    sleep: sleeper.sleep,
    random: () => 0,
    ...options
  });
  return { client, session, delays: sleeper.delays };
}

const ask = (query: string, count = 5) => ({ query, count });

describe("web search session budget and cache", () => {
  it("answers a repeated search from the cache without spending the budget", async () => {
    const { client, session } = setup([[hit(1)]]);
    const first = await session.search(ask("  唐代  驿站 "));
    const again = await session.search(ask("唐代 驿站"));
    expect(client.requests).toHaveLength(1);
    expect(first).toMatchObject({ cached: false, callIndex: 1, callLimit: 20 });
    expect(again).toMatchObject({ cached: true, callIndex: 1 });
    await session.search(ask("唐代 驿站", 3));
    expect(client.requests).toHaveLength(2);
  });

  it("stops at the call limit yet still answers what it already knows", async () => {
    const { client, session } = setup(
      [[hit(1)]],
      runtimeConfig({ perRunCallLimit: 2 })
    );
    await session.search(ask("一"));
    await session.search(ask("二"));
    await expect(session.search(ask("三"))).rejects.toMatchObject({
      callLimit: 2
    });
    await expect(session.search(ask("三"))).rejects.toBeInstanceOf(
      WebSearchLimitError
    );
    await expect(session.search(ask("一"))).resolves.toMatchObject({
      cached: true
    });
    expect(client.requests).toHaveLength(2);
  });

  it("shares one request between identical searches in flight", async () => {
    const gate = deferred<ReturnType<typeof hit>[]>();
    const { client, session } = setup([() => gate.promise]);
    const first = session.search(ask("同一件事"));
    const second = session.search(ask("同一件事"));
    gate.resolve([hit(1)]);
    const [one, two] = await Promise.all([first, second]);
    expect(client.requests).toHaveLength(1);
    expect([one.cached, two.cached]).toEqual([false, true]);
  });

  it("never remembers a failed search and counts it once", async () => {
    const { client, session } = setup([
      new WebSearchProviderError("auth", false),
      [hit(1)]
    ]);
    await expect(session.search(ask("查"))).rejects.toMatchObject({
      kind: "auth"
    });
    await expect(session.search(ask("查"))).resolves.toMatchObject({
      cached: false,
      callIndex: 2
    });
    expect(client.requests).toHaveLength(2);
  });

  it("returns no more hits than were asked for", async () => {
    const { session } = setup([[hit(1), hit(2), hit(3)]]);
    expect((await session.search(ask("多", 2))).hits).toHaveLength(2);
  });

  it("never offers more results than the provider allows", () => {
    expect(
      setup([[]], runtimeConfig({ maxResults: 50 })).session.maxResults
    ).toBe(20);
  });
});

describe("web search session retries", () => {
  it("retries transient failures after one and then three seconds", async () => {
    const { client, session, delays } = setup([
      new WebSearchProviderError("rate_limit", true),
      new WebSearchProviderError("unavailable", true),
      [hit(1)]
    ]);
    await expect(session.search(ask("重试"))).resolves.toMatchObject({
      callIndex: 1
    });
    expect(client.requests).toHaveLength(3);
    expect(delays).toEqual([1_000, 3_000]);
  });

  it("follows Retry-After, capped at ten seconds", async () => {
    const { session, delays } = setup([
      new WebSearchProviderError("rate_limit", true, 2_500),
      new WebSearchProviderError("rate_limit", true, 60_000),
      [hit(1)]
    ]);
    await session.search(ask("等待"));
    expect(delays).toEqual([2_500, 10_000]);
  });

  it("gives up after two retries with the last failure", async () => {
    const { client, session } = setup([
      new WebSearchProviderError("unavailable", true),
      new WebSearchProviderError("unavailable", true),
      new WebSearchProviderError("timeout", true)
    ]);
    await expect(session.search(ask("放弃"))).rejects.toMatchObject({
      kind: "timeout"
    });
    expect(client.requests).toHaveLength(3);
  });

  it.each(["auth", "balance", "bad_request", "invalid_response"] as const)(
    "does not retry %s",
    async (kind) => {
      const { client, session, delays } = setup([
        new WebSearchProviderError(kind, false)
      ]);
      await expect(session.search(ask("不重试"))).rejects.toMatchObject({
        kind
      });
      expect(client.requests).toHaveLength(1);
      expect(delays).toEqual([]);
    }
  );

  it("treats the request timeout as a retryable timeout", async () => {
    const { client, session } = setup([
      new DOMException("slow", "TimeoutError") as unknown as Error,
      [hit(1)]
    ]);
    await expect(session.search(ask("超时"))).resolves.toMatchObject({
      callIndex: 1
    });
    expect(client.requests).toHaveLength(2);
  });

  it("times a stuck request out by itself", async () => {
    const client = scriptedClient([[]]);
    let seenSignal: AbortSignal | undefined;
    client.search = (_request, context) => {
      seenSignal = context.signal;
      // Never answers; only the timeout signal ends the wait.
      return new Promise((_, reject) =>
        context.signal.addEventListener("abort", () =>
          reject(context.signal.reason)
        )
      );
    };
    const session = createWebSearchSession(runtimeConfig(), {
      client,
      limiter: instantLimiter(),
      retryDelaysMs: [],
      timeoutMs: 30
    });
    await expect(session.search(ask("卡住"))).rejects.toMatchObject({
      kind: "timeout",
      retryable: true
    });
    expect(seenSignal?.aborted).toBe(true);
  });
});

describe("web search session abort", () => {
  it("stops while waiting to retry, without another request", async () => {
    const controller = new AbortController();
    const client = scriptedClient([
      new WebSearchProviderError("rate_limit", true)
    ]);
    const session = createWebSearchSession(runtimeConfig(), {
      client,
      limiter: instantLimiter(),
      retryDelaysMs: [60_000],
      signal: controller.signal
    });
    const outcome = session.search(ask("中止")).catch((e: unknown) => e);
    await vi.waitFor(() => expect(client.requests).toHaveLength(1));
    controller.abort(new Error("run stopped"));
    expect(await outcome).toMatchObject({ message: "run stopped" });
    expect(client.requests).toHaveLength(1);
  });

  it("stops on the call's own signal and forgets the attempt", async () => {
    const controller = new AbortController();
    controller.abort(new Error("tool cancelled"));
    const { client, session } = setup([[hit(1)]]);
    await expect(
      session.search(ask("取消"), controller.signal)
    ).rejects.toThrow("tool cancelled");
    expect(client.requests).toHaveLength(0);
    await expect(session.search(ask("取消"))).resolves.toMatchObject({
      cached: false
    });
  });
});

describe("web search session wiring", () => {
  it("identifies the key to the limiter only by a fingerprint", async () => {
    const acquire = vi.fn(async () => undefined);
    const limiter = { acquire } as unknown as WebSearchRateLimiter;
    const { session } = setup([[hit(1)]], runtimeConfig(), { limiter });
    await session.search(ask("指纹"));
    const [key, qps] = acquire.mock.calls[0] as unknown as [string, number];
    expect(key).toMatch(/^deepseek:[0-9a-f]{16}$/u);
    expect(key).not.toContain(TEST_KEY);
    expect(qps).toBe(5);
  });

  it("passes the key, address and standard fetch to the client", async () => {
    const seen: { apiKey?: string; baseUrl?: string; fetch?: unknown } = {};
    const fetchStub = vi.fn() as unknown as typeof fetch;
    const client = scriptedClient([
      async () => {
        return [];
      }
    ]);
    const original = client.search.bind(client);
    client.search = (request, context) => {
      Object.assign(seen, context);
      return original(request, context);
    };
    const session = createWebSearchSession(runtimeConfig(), {
      client,
      limiter: instantLimiter(),
      fetch: fetchStub
    });
    await session.search(ask("参数"));
    expect(seen).toMatchObject({
      apiKey: TEST_KEY,
      baseUrl: "https://search.example.test",
      fetch: fetchStub
    });
  });

  it("serves the local Faux runtime without any network", async () => {
    const fetchStub = vi.fn();
    const session = createWebSearchSession(runtimeConfig(), {
      localFaux: true,
      limiter: instantLimiter(),
      fetch: fetchStub as unknown as typeof fetch
    });
    const outcome = await session.search(ask("本地演示"));
    expect(outcome.hits.length).toBeGreaterThan(0);
    expect(
      outcome.hits.every((entry) =>
        entry.url.startsWith("https://example.test/")
      )
    ).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
