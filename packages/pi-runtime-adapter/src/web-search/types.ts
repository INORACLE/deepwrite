import type { WebSearchProviderId } from "@deepwrite/contracts";

export interface WebSearchRequest {
  query: string;
  count: number;
  /** The user's own question behind the search; providers that cannot use it ignore it. */
  question?: string;
}

export interface WebSearchHit {
  title: string;
  /** Always an http(s) address. */
  url: string;
  siteName?: string;
  /** RFC 3339 timestamp. */
  publishedAt?: string;
  /** Short summary, shown to the user. */
  snippet: string;
  /** Longer summary, read by the model. */
  summary: string;
  score?: number;
  authority?: number;
}

export type WebSearchFailureKind =
  | "auth"
  | "balance"
  | "rate_limit"
  | "timeout"
  | "bad_request"
  | "unavailable"
  | "invalid_response";

export class WebSearchProviderError extends Error {
  constructor(
    readonly kind: WebSearchFailureKind,
    readonly retryable: boolean,
    readonly retryAfterMs?: number
  ) {
    super(kind);
    this.name = "WebSearchProviderError";
  }
}

export type WebSearchFetch = typeof fetch;

export interface WebSearchProviderContext {
  apiKey: string;
  baseUrl: string;
  fetch: WebSearchFetch;
  /** Run abort and request timeout, already merged. */
  signal: AbortSignal;
}

/**
 * One request to a search service. Retries, pacing, caching and call counting
 * belong to the search session, which every provider shares.
 */
export interface WebSearchProviderClient {
  readonly id: WebSearchProviderId;
  /** Requests per second the service allows one key. */
  readonly maxQps: number;
  /** Query syntax worth telling the model about. */
  readonly queryHint: string;
  search(
    request: WebSearchRequest,
    context: WebSearchProviderContext
  ): Promise<WebSearchHit[]>;
}
