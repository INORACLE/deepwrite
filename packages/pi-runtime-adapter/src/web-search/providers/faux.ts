import type { WebSearchHit, WebSearchProviderClient } from "../types";

const EMPTY_MARKER = "无结果";
const MAX_FAUX_RESULTS = 3;

/**
 * Stands in for the real service in the local Faux runtime: no network, fixed
 * results, reserved example addresses. A query containing “无结果” finds nothing.
 */
export const fauxWebSearchClient: WebSearchProviderClient = {
  id: "deepseek",
  maxQps: 1_000,
  queryHint: "本地演示搜索源，返回固定的示例结果。",
  async search(request): Promise<WebSearchHit[]> {
    if (request.query.includes(EMPTY_MARKER)) return [];
    const slug = encodeURIComponent(request.query).slice(0, 48);
    return Array.from(
      { length: Math.min(request.count, MAX_FAUX_RESULTS) },
      (_, index) => ({
        title: `「${request.query}」相关资料 ${index + 1}`,
        url: `https://example.test/search/${slug}/${index + 1}`,
        siteName: "示例资料站",
        publishedAt: `2026-01-0${index + 1}T00:00:00+00:00`,
        snippet: `示例摘要 ${index + 1}：关于「${request.query}」的公开资料。`,
        summary: `示例长摘要 ${index + 1}：这是本地演示搜索源为「${request.query}」生成的固定内容，不来自真实网页。`
      })
    );
  }
};
