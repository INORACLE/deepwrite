import { WEB_SEARCH_PROVIDERS } from "@deepwrite/contracts";
import {
  WebSearchProviderError,
  type WebSearchHit,
  type WebSearchProviderClient
} from "../types";

/** https://api-docs.deepseek.com/zh-cn/api/search */
const SEARCH_PATH = "/v1/tools/search";
const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_COUNT = 50;
const MAX_RETRY_AFTER_MS = 10_000;

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/** Seconds, or an HTTP date, as milliseconds; unusable values give undefined. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms >= 0
    ? Math.min(Math.round(ms), MAX_RETRY_AFTER_MS)
    : undefined;
}

function failureFor(response: Response): WebSearchProviderError {
  const { status } = response;
  if (status === 401) return new WebSearchProviderError("auth", false);
  if (status === 402) return new WebSearchProviderError("balance", false);
  if (status === 400 || status === 413)
    return new WebSearchProviderError("bad_request", false);
  if (status === 429)
    return new WebSearchProviderError(
      "rate_limit",
      true,
      retryAfterMs(response.headers.get("retry-after"))
    );
  if (status === 408 || status === 504)
    return new WebSearchProviderError("timeout", true);
  return new WebSearchProviderError("unavailable", status >= 500);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new WebSearchProviderError("invalid_response", false);
  }
  if (!response.body)
    throw new WebSearchProviderError("invalid_response", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > RESPONSE_LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new WebSearchProviderError("invalid_response", false);
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new WebSearchProviderError("invalid_response", false);
  }
}

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Unknown fields are ignored; a result without a title or http(s) link is dropped. */
function toHit(raw: unknown): WebSearchHit | undefined {
  if (!isRecord(raw)) return undefined;
  const title = text(raw.title);
  const url = typeof raw.url === "string" ? httpUrl(raw.url) : undefined;
  if (title === undefined || !url) return undefined;
  const snippet = text(raw.snippet) ?? "";
  const siteName = text(raw.site_name);
  const date = text(raw.date);
  const score = number(raw.rerank_score);
  const authority = number(raw.authority);
  return {
    title,
    url,
    snippet,
    summary: text(raw.summary) || snippet,
    ...(siteName ? { siteName } : {}),
    ...(date && !Number.isNaN(Date.parse(date)) ? { publishedAt: date } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(authority !== undefined ? { authority } : {})
  };
}

export const deepSeekWebSearchClient: WebSearchProviderClient = {
  id: "deepseek",
  maxQps: 5,
  queryHint:
    '支持 site:域名、-site:域名、"精确短语"、-排除词、lang:zh、after:2025、before:2026-01-01，可组合使用。',
  async search(request, context) {
    const limit = WEB_SEARCH_PROVIDERS.deepseek.queryMaxChars;
    if (!request.query.trim() || [...request.query].length > limit)
      throw new WebSearchProviderError("bad_request", false);
    const question = request.question?.trim().slice(0, limit);
    let response: Response;
    try {
      response = await context.fetch(
        `${context.baseUrl.replace(/\/+$/u, "")}${SEARCH_PATH}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${context.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            query: request.query,
            count: Math.min(Math.max(1, request.count), MAX_COUNT),
            ...(question ? { ori_question: question } : {}),
            need_content: false
          }),
          signal: context.signal
        }
      );
    } catch (error) {
      // Aborts and timeouts reach the session unchanged; the rest is transport.
      if (isAbortLike(error)) throw error;
      throw new WebSearchProviderError("unavailable", true);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw failureFor(response);
    }
    const body = await readBoundedJson(response);
    if (!isRecord(body) || !Array.isArray(body.results))
      throw new WebSearchProviderError("invalid_response", false);
    return body.results.flatMap((raw: unknown) => toHit(raw) ?? []);
  }
};
