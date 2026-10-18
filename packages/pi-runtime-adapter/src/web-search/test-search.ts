import type { WebSearchProviderId } from "@deepwrite/contracts";
import { clipText } from "./format";
import { webSearchClient } from "./registry";
import {
  WebSearchProviderError,
  type WebSearchFetch,
  type WebSearchHit
} from "./types";

const TEST_RESULT_COUNT = 3;

export interface WebSearchProviderTestInput {
  providerId: WebSearchProviderId;
  baseUrl: string;
  apiKey: string;
  query: string;
}

export interface WebSearchProviderTestResult {
  resultCount: number;
  samples: { title: string; url: string; siteName?: string }[];
}

function sample(hit: WebSearchHit) {
  return {
    title: clipText(hit.title, 200),
    url: hit.url,
    ...(hit.siteName ? { siteName: clipText(hit.siteName, 60) } : {})
  };
}

/**
 * One search to check a key and the connection: no pacing, caching or
 * retries. Failures are `WebSearchProviderError`; the caller turns them into
 * words for the user.
 */
export async function testWebSearchProvider(
  input: WebSearchProviderTestInput,
  options: { fetch?: WebSearchFetch; signal: AbortSignal }
): Promise<WebSearchProviderTestResult> {
  let hits: WebSearchHit[];
  try {
    hits = await webSearchClient(input.providerId).search(
      { query: input.query, count: TEST_RESULT_COUNT },
      {
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        fetch: options.fetch ?? fetch,
        signal: options.signal
      }
    );
  } catch (error) {
    // The only signal here is the caller's timeout.
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      throw new WebSearchProviderError("timeout", true);
    throw error;
  }
  return {
    resultCount: hits.length,
    samples: hits.slice(0, TEST_RESULT_COUNT).map(sample)
  };
}
