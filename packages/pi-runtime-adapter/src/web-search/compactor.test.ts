import { describe, expect, it } from "vitest";
import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { webSearchCompactor } from "./compactor";
import { formatWebSearchResult } from "./format";
import { hit } from "./test-support";
import type { WebSearchToolDetails } from "./tool";

const hits = Array.from({ length: 12 }, (_, index) =>
  hit(index + 1, { summary: "文".repeat(300) })
);

function resultMessage(
  text: string,
  overrides: Partial<ToolResultMessage> = {}
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "web_search",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
    ...overrides
  } as ToolResultMessage;
}

const call = (query: unknown): ToolCall =>
  ({
    type: "toolCall",
    id: "call_1",
    name: "web_search",
    arguments: { query }
  }) as ToolCall;

describe("webSearchCompactor", () => {
  it("keeps short results and failures as they are", () => {
    const short = resultMessage(formatWebSearchResult("短", [hit(1)]));
    expect(webSearchCompactor.result!(short, call("短"))).toBeUndefined();
    const failure = resultMessage("错".repeat(2_000), { isError: true });
    expect(webSearchCompactor.result!(failure, call("错"))).toBeUndefined();
  });

  it("replaces an old result by the query and the first ten titles and links", () => {
    const details: WebSearchToolDetails = {
      kind: "web-search",
      providerId: "deepseek",
      query: "唐代驿站",
      cached: false,
      callIndex: 1,
      callLimit: 20,
      results: hits.map(({ title, url, snippet }) => ({ title, url, snippet }))
    };
    const message = resultMessage(formatWebSearchResult("唐代驿站", hits), {
      details: details as never
    });
    const placeholder = webSearchCompactor.result!(message, call("唐代驿站"))!;
    expect(placeholder).toContain("已联网搜索「唐代驿站」，共 12 条结果");
    expect(placeholder).toContain("1. 结果 1 https://example.test/1");
    expect(placeholder).toContain("10. 结果 10 https://example.test/10");
    expect(placeholder).not.toContain("11. ");
    expect(placeholder).toContain("摘要已移出上下文");
    expect(placeholder).not.toContain("文".repeat(50));
  });

  it("reads titles and links from the text when the conversation was restored", () => {
    const message = resultMessage(formatWebSearchResult("恢复", hits));
    const placeholder = webSearchCompactor.result!(message, undefined)!;
    expect(placeholder).toContain("已联网搜索「恢复」，共 12 条结果");
    expect(placeholder).toContain("3. 结果 3 https://example.test/3");
  });
});
