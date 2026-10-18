export { webSearchCompactor } from "./compactor";
export { withWebSearchTool } from "./mount";
export {
  WEB_SEARCH_PROMPT,
  hasWebSearchTool,
  webSearchPromptFor
} from "./prompt";
export {
  WebSearchLimitError,
  createWebSearchSession,
  type CreateWebSearchSessionOptions,
  type WebSearchOutcome,
  type WebSearchSession
} from "./session";
export { testWebSearchProvider } from "./test-search";
export type {
  WebSearchProviderTestInput,
  WebSearchProviderTestResult
} from "./test-search";
export {
  WEB_SEARCH_TOOL_NAME,
  buildWebSearchTool,
  isWebSearchToolDetails,
  webSearchFailureMessage,
  type WebSearchToolDetails
} from "./tool";
export { WebSearchProviderError } from "./types";
export type {
  WebSearchFailureKind,
  WebSearchFetch,
  WebSearchHit,
  WebSearchProviderClient,
  WebSearchRequest
} from "./types";
