import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WebSearchSession } from "./session";
import { WEB_SEARCH_TOOL_NAME, buildWebSearchTool } from "./tool";

/**
 * Whether the run's main agent has search: the user switched it on and Main
 * supplied the settings. Members may still search without it, see
 * `subagentWebSearchAllowed`.
 */
export function mainAgentHasWebSearch(input: {
  webSearch?: unknown;
  webSearchEnabled?: boolean | undefined;
}): boolean {
  return input.webSearch !== undefined && input.webSearchEnabled === true;
}

/** The session the main agent may mount, if any. */
export function mainWebSearchSession(
  session: WebSearchSession | undefined,
  input: { webSearchEnabled?: boolean | undefined }
): WebSearchSession | undefined {
  return input.webSearchEnabled === true ? session : undefined;
}

/**
 * The one place a tool list gains web search. Without a session (search is off
 * or unconfigured) or when it is already there, the list is returned as is.
 */
export function withWebSearchTool(
  tools: AgentTool[],
  session: WebSearchSession | undefined
): AgentTool[] {
  if (!session || tools.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME))
    return tools;
  return [...tools, buildWebSearchTool(session)];
}
