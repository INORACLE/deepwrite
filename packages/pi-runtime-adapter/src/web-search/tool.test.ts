import { describe, expect, it } from "vitest";
import { createWebSearchSession } from "./session";
import {
  WEB_SEARCH_TOOL_NAME,
  buildWebSearchTool,
  isWebSearchToolDetails,
  webSearchFailureMessage
} from "./tool";
import {
  TEST_KEY,
  hit,
  instantLimiter,
  recordingSleep,
  runtimeConfig,
  scriptedClient
} from "./test-support";
import { WebSearchProviderError, type WebSearchFailureKind } from "./types";

function setup(
  steps: Parameters<typeof scriptedClient>[0],
  config = runtimeConfig()
) {
  const client = scriptedClient(steps);
  const session = createWebSearchSession(config, {
    client,
    limiter: instantLimiter(),
    sleep: recordingSleep().sleep,
    retryDelaysMs: []
  });
  const tool = buildWebSearchTool(session);
  const run = (params: Record<string, unknown>, signal?: AbortSignal) =>
    tool.execute("call_1", params as never, signal);
  return { client, session, tool, run };
}

const textOf = (result: Awaited<ReturnType<ReturnType<typeof setup>["run"]>>) =>
  (result.content[0] as { text: string }).text;

describe("web_search tool definition", () => {
  it("is a flat object whose only required field is the query", () => {
    const { tool } = setup([[]], runtimeConfig({ maxResults: 6 }));
    expect(tool.name).toBe(WEB_SEARCH_TOOL_NAME);
    expect(tool.label).toBe("联网搜索");
    expect(tool.parameters).toMatchObject({
      type: "object",
      required: ["query"],
      additionalProperties: false
    });
    expect(
      Object.keys(
        (tool.parameters as { properties: Record<string, unknown> }).properties
      )
    ).toEqual(["query", "count", "question"]);
    expect(tool.description).toContain("128");
    expect(tool.description).toContain("最多 6 条");
    expect(tool.description).toContain("测试语法提示。");
  });
});

describe("web_search tool results", () => {
  it("returns labelled text for the model and details for the interface", async () => {
    const { run } = setup([[hit(1), hit(2)]]);
    const result = await run({ query: "  唐代  驿站 " });
    expect(textOf(result)).toContain("联网搜索：唐代 驿站");
    expect(textOf(result)).toContain("[1] 结果 1");
    expect(textOf(result)).toContain(
      "来源：示例站 · 2026-06-01 · https://example.test/1"
    );
    expect(isWebSearchToolDetails(result.details)).toBe(true);
    expect(result.details).toMatchObject({
      kind: "web-search",
      providerId: "deepseek",
      query: "唐代 驿站",
      cached: false,
      callIndex: 1,
      callLimit: 20,
      results: [
        {
          title: "结果 1",
          url: "https://example.test/1",
          siteName: "示例站",
          publishedAt: "2026-06-01T00:00:00+00:00",
          snippet: "短摘要 1"
        },
        { title: "结果 2" }
      ]
    });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it("marks a repeated search as cached", async () => {
    const { run } = setup([[hit(1)]]);
    await run({ query: "重复" });
    expect((await run({ query: "重复" })).details).toMatchObject({
      cached: true,
      callIndex: 1
    });
  });

  it("keeps the count between one and the session maximum", async () => {
    const { client, run } = setup([[]], runtimeConfig({ maxResults: 4 }));
    await run({ query: "甲", count: 10 });
    await run({ query: "乙" });
    await run({ query: "丙", count: 0 });
    await run({ query: "丁", count: 2.9 });
    expect(client.requests.map((request) => request.count)).toEqual([
      4, 4, 1, 2
    ]);
  });

  it("passes the user's question on, clipped", async () => {
    const { client, run } = setup([[]]);
    await run({ query: "问", question: "问".repeat(200) });
    await run({ query: "无问" });
    expect(client.requests[0]!.question).toBe(`${"问".repeat(128)}…`);
    expect(client.requests[1]).not.toHaveProperty("question");
  });

  it("answers an empty search as a normal result", async () => {
    const { run } = setup([[]]);
    const result = await run({ query: "冷门" });
    expect(textOf(result)).toContain("没有找到相关结果");
    expect(result.details).toMatchObject({ results: [] });
  });
});

describe("web_search tool failures", () => {
  it("refuses an empty or over-long query with a plain reason", async () => {
    const { client, run } = setup([[]]);
    await expect(run({ query: "   " })).rejects.toThrow("查询词不能为空");
    await expect(run({ query: "字".repeat(129) })).rejects.toThrow(
      "查询词超过 128 字，请精简后重试"
    );
    expect(client.requests).toHaveLength(0);
  });

  it.each([
    ["auth", "密钥无效或已失效"],
    ["balance", "余额不足"],
    ["rate_limit", "过于频繁"],
    ["bad_request", "请调整查询词"],
    ["timeout", "暂时不可用"],
    ["unavailable", "暂时不可用"],
    ["invalid_response", "暂时不可用"]
  ] as [WebSearchFailureKind, string][])(
    "tells the model what %s means without service details",
    async (kind, expected) => {
      const { run } = setup([new WebSearchProviderError(kind, false)]);
      const error = await run({ query: "失败" }).catch((e: unknown) => e);
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toContain(TEST_KEY);
    }
  );

  it("asks the user to check the key and to top up, as the model's next step", () => {
    expect(
      webSearchFailureMessage(new WebSearchProviderError("auth", false))
    ).toContain("设置 → 个人 → 联网搜索");
    expect(
      webSearchFailureMessage(new WebSearchProviderError("balance", false))
    ).toContain("充值");
  });

  it("hides unexpected errors and reports an exhausted budget", async () => {
    const { run } = setup(
      [new Error(`socket reset for ${TEST_KEY}`), [hit(1)]],
      runtimeConfig({ perRunCallLimit: 1 })
    );
    const unexpected = await run({ query: "意外" }).catch((e: unknown) => e);
    expect((unexpected as Error).message).toBe(
      "联网搜索服务暂时不可用，本次没有获得结果。"
    );
    await expect(run({ query: "超额" })).rejects.toThrow(
      "本轮联网搜索已达上限（1 次）"
    );
  });

  it("lets a stopped run stay a stop", async () => {
    const { client, run } = setup([[hit(1)]]);
    const controller = new AbortController();
    controller.abort(new Error("run stopped"));
    await expect(run({ query: "停" }, controller.signal)).rejects.toThrow(
      "run stopped"
    );
    expect(client.requests).toHaveLength(0);
  });
});
