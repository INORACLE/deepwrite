import { describe, expect, it, vi } from "vitest";
import { deepSeekWebSearchClient } from "./providers/deepseek";
import { WebSearchProviderError, type WebSearchFailureKind } from "./types";
import { TEST_KEY } from "./test-support";

const RAW = {
  rerank_score: 2.4,
  title: " DeepSeek V4 model released ",
  url: "https://example.test/deepseek-v4",
  snippet: "短摘要",
  summary: "长摘要",
  content: "",
  site_name: "示例新闻",
  site_icon: null,
  date: "2026-06-01T00:00:00+00:00",
  authority: 3,
  unexpected_field: true
};

function search(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  request = { query: "DeepSeek V4", count: 5 } as {
    query: string;
    count: number;
    question?: string;
  }
) {
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) =>
      respond(String(url), init!)
  );
  const result = deepSeekWebSearchClient.search(request, {
    apiKey: TEST_KEY,
    baseUrl: "https://search.example.test/",
    fetch: fetchMock as unknown as typeof fetch,
    signal: new AbortController().signal
  });
  return { result, fetchMock };
}

async function failureOf(response: Response): Promise<WebSearchProviderError> {
  const error = await search(() => response).result.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(WebSearchProviderError);
  return error as WebSearchProviderError;
}

describe("DeepSeek search client", () => {
  it("posts the documented request with the key as a bearer token", async () => {
    const { result, fetchMock } = search(() => Response.json({ results: [] }), {
      query: "DeepSeek V4",
      count: 99,
      question: "  DeepSeek V4 什么时候发布？ "
    });
    await result;
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://search.example.test/v1/tools/search");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json"
      }
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      query: "DeepSeek V4",
      count: 50,
      ori_question: "DeepSeek V4 什么时候发布？",
      need_content: false
    });
  });

  it("leaves out an empty original question", async () => {
    const { result, fetchMock } = search(() => Response.json({ results: [] }));
    await result;
    expect(
      JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    ).not.toHaveProperty("ori_question");
  });

  it("maps results, ignoring unknown fields and dropping unusable ones", async () => {
    const hits = await search(() =>
      Response.json({
        results: [
          RAW,
          { ...RAW, url: "javascript:alert(1)" },
          { ...RAW, url: "not a url" },
          { title: "没有链接" },
          "not an object",
          {
            title: "最小结果",
            url: "http://example.test/min",
            site_name: null,
            date: "garbled"
          }
        ]
      })
    ).result;
    expect(hits).toEqual([
      {
        title: "DeepSeek V4 model released",
        url: "https://example.test/deepseek-v4",
        snippet: "短摘要",
        summary: "长摘要",
        siteName: "示例新闻",
        publishedAt: "2026-06-01T00:00:00+00:00",
        score: 2.4,
        authority: 3
      },
      {
        title: "最小结果",
        url: "http://example.test/min",
        snippet: "",
        summary: ""
      }
    ]);
  });

  it("falls back to the short summary for the model", async () => {
    const [only] = await search(() =>
      Response.json({ results: [{ ...RAW, summary: "" }] })
    ).result;
    expect(only!.summary).toBe("短摘要");
  });

  it.each([
    [400, "bad_request", false],
    [413, "bad_request", false],
    [401, "auth", false],
    [402, "balance", false],
    [408, "timeout", true],
    [504, "timeout", true],
    [429, "rate_limit", true],
    [500, "unavailable", true],
    [502, "unavailable", true],
    [404, "unavailable", false]
  ] as [number, WebSearchFailureKind, boolean][])(
    "maps HTTP %i to %s (retryable: %s)",
    async (status, kind, retryable) => {
      const error = await failureOf(
        new Response(
          JSON.stringify({ error: { message: `secret ${TEST_KEY}` } }),
          {
            status
          }
        )
      );
      expect(error).toMatchObject({ kind, retryable });
      expect(error.message).toBe(kind);
    }
  );

  it("reads Retry-After in seconds or as a date, capped at ten seconds", async () => {
    const seconds = await failureOf(
      new Response("{}", { status: 429, headers: { "retry-after": "2" } })
    );
    expect(seconds.retryAfterMs).toBe(2_000);
    const long = await failureOf(
      new Response("{}", { status: 429, headers: { "retry-after": "600" } })
    );
    expect(long.retryAfterMs).toBe(10_000);
    const junk = await failureOf(
      new Response("{}", { status: 429, headers: { "retry-after": "soon" } })
    );
    expect(junk.retryAfterMs).toBeUndefined();
  });

  it("rejects bodies that are not the documented shape or too large", async () => {
    for (const body of ["not json", "[]", '{"results":"x"}', "{}"]) {
      const error = await search(() => new Response(body)).result.catch(
        (e: unknown) => e
      );
      expect(error).toMatchObject({
        kind: "invalid_response",
        retryable: false
      });
    }
    const declared = await search(
      () => new Response("{}", { headers: { "content-length": "3000000" } })
    ).result.catch((e: unknown) => e);
    expect(declared).toMatchObject({ kind: "invalid_response" });
    const streamed = await search(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let index = 0; index < 3; index += 1)
                controller.enqueue(new Uint8Array(1024 * 1024));
              controller.close();
            }
          })
        )
    ).result.catch((e: unknown) => e);
    expect(streamed).toMatchObject({ kind: "invalid_response" });
  });

  it("reports transport failures as retryable and passes aborts through", async () => {
    const transport = await search(() => {
      throw new TypeError(`fetch failed for ${TEST_KEY}`);
    }).result.catch((e: unknown) => e);
    expect(transport).toMatchObject({ kind: "unavailable", retryable: true });
    expect((transport as Error).message).not.toContain(TEST_KEY);
    for (const name of ["AbortError", "TimeoutError"]) {
      const aborted = new DOMException("stopped", name);
      const error = await search(() => {
        throw aborted;
      }).result.catch((e: unknown) => e);
      expect(error).toBe(aborted);
    }
  });

  it("refuses an empty or over-long query without sending anything", async () => {
    for (const query of [" ", "字".repeat(129)]) {
      const { result, fetchMock } = search(
        () => Response.json({ results: [] }),
        {
          query,
          count: 5
        }
      );
      await expect(result).rejects.toMatchObject({ kind: "bad_request" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
    const { result } = search(() => Response.json({ results: [] }), {
      query: "字".repeat(128),
      count: 5
    });
    await expect(result).resolves.toEqual([]);
  });
});
